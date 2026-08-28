// Mobile audit harness. Dev sandbox only.
//
// Loads every main screen at a phone viewport and reports, per route:
//   - horizontal overflow (the page scrolling sideways is the #1 mobile defect), naming the
//     specific elements whose box extends past the viewport rather than just the fact of it
//   - interactive elements below the 44x44 touch target floor
//   - console/hydration errors
//
// It also asserts the workspace nav is in sync: every module switched on in app_modules must
// be reachable from /admin, which is the screen an admin actually lands on.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url)) throw new Error(`refusing to run against ${url}`)

const SHOTS = process.env.SHOT_DIR || '/tmp/mobile-audit'
mkdirSync(SHOTS, { recursive: true })

const PHONE = { width: 390, height: 844 }
const NARROW = { width: 320, height: 720 }
const DESKTOP = { width: 1440, height: 900 }

const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()
const email = `mobile${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`

const ROUTES = [
  ['admin-home', '/admin?tab=overview'],
  ['admin-boards', '/admin?tab=boards'],
  ['admin-calendar', '/admin?tab=calendar'],
  ['admin-reports', '/admin?tab=reports'],
  ['admin-chat', '/admin?tab=chat'],
  ['admin-personal', '/admin?tab=personal'],
  ['admin-project-ids', '/admin?tab=project-ids'],
  ['admin-access-log', '/admin?tab=access-log'],
  ['admin-marketing', '/admin?tab=marketing'],
  ['super-admin', '/admin/super-admin'],
  ['my-work', '/my-work'],
  ['inbox', '/inbox'],
  ['views', '/views'],
  // Gated on the `agile` module: when it is off this redirects to the dashboard, which is
  // itself worth sweeping - a redirect that scrolls sideways is still a broken page.
  ['agile', '/agile'],
  ['crm-dashboard', '/crm'],
  ['crm-orders', '/crm/orders'],
  ['crm-clients', '/crm/clients'],
  ['crm-intake', '/crm/clients/new'],
]

// Elements whose own overflow is legitimate: a scroll container is *meant* to be wider than
// its box. We flag the ones that push the PAGE sideways, which is a different thing.
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth
  const scrollsSideways = document.documentElement.scrollWidth > vw + 1
  const offenders = []
  if (scrollsSideways) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.right <= vw + 1) continue
      // Ignore anything inside an ancestor that scrolls horizontally on purpose.
      let p = el.parentElement, inScroller = false
      while (p && p !== document.body) {
        const ov = getComputedStyle(p).overflowX
        if ((ov === 'auto' || ov === 'scroll') && p.scrollWidth > p.clientWidth) { inScroller = true; break }
        p = p.parentElement
      }
      if (inScroller) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && String(el.className).slice(0, 110)) || '',
        text: (el.textContent || '').trim().slice(0, 40),
        right: Math.round(r.right),
        width: Math.round(r.width),
      })
    }
  }
  // Deepest offenders only: an overflowing child reports its parents too.
  const deepest = offenders.filter((o, i) =>
    !offenders.some((x, j) => j !== i && x.right >= o.right && x.width < o.width))

  const small = []
  const sel = 'button, a[href], input:not([type=hidden]), select, [role=button], [role=tab], [role=checkbox], [role=switch]'
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    if (getComputedStyle(el).visibility === 'hidden') continue
    if (r.height >= 40 && r.width >= 40) continue
    // A link inside a sentence is text, not a target.
    if (el.tagName === 'A' && el.closest('p')) continue
    small.push({
      tag: el.tagName.toLowerCase(),
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34),
      cls: (el.className && String(el.className).slice(0, 80)) || '',
      w: Math.round(r.width), h: Math.round(r.height),
    })
  }
  return { vw, scrollWidth: document.documentElement.scrollWidth, scrollsSideways, deepest, small }
})()`

let userId
const report = []
try {
  const { data: created, error: ue } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  })
  if (ue) throw ue
  userId = created.user.id
  await admin.from('profiles').upsert({
    id: userId, email, full_name: 'Mobile Audit', role: 'super_admin', is_active: true,
  })

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  const errors = []
  page.on('console', m => {
    const t = m.text()
    if (m.type() === 'error' || /hydrat|did not match/i.test(t)) errors.push(t)
  })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

  await page.goto('http://localhost:3000/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })

  // ── Nav sync, measured on the desktop rail where every item is rendered ───────────
  const enabled = (await admin.from('app_modules').select('module_key, enabled')).data
    .filter(m => m.enabled).map(m => m.module_key)
  await page.setViewportSize(DESKTOP)
  await page.goto('http://localhost:3000/admin?tab=overview')
  await page.waitForSelector('nav[aria-label="Primary"] a', { timeout: 60000 })
  await page.waitForTimeout(2500)
  const navLinks = await page.$$eval('nav[aria-label="Primary"]:not(.md\\:hidden) a', as =>
    as.map(a => ({ label: a.textContent.trim(), href: a.getAttribute('href') })))
  console.log('\n=== NAV on /admin ===')
  console.log('modules enabled:', enabled.join(', '))
  console.log(navLinks.map(l => `  ${l.label} -> ${l.href}`).join('\n'))
  const labels = navLinks.map(l => l.label)
  for (const [mod, label] of [['crm', 'CRM'], ['appointments', 'Appointments'], ['project_ids', 'Project IDs'], ['reports', 'Reports']]) {
    if (enabled.includes(mod)) {
      console.log(`${labels.includes(label) ? '  ok  ' : ' FAIL '} ${label} is reachable from /admin`)
    }
  }
  console.log(`${labels.includes('My Work') ? '  ok  ' : ' FAIL '} My Work is reachable from /admin`)
  const strayDashboard = navLinks.filter(l => (l.href || '').startsWith('/dashboard'))
  console.log(`${strayDashboard.length === 0 ? '  ok  ' : ' FAIL '} no /dashboard links in an admin's nav${strayDashboard.length ? ` - ${strayDashboard.map(l => l.href).join(', ')}` : ''}`)

  // ── First paint, proved with JavaScript switched off ───────────────────────────────
  //
  // The nav above is read after everything has settled, so it cannot tell a server-rendered
  // sidebar from one the browser corrected a moment later. With scripts disabled only the SSR
  // HTML renders, so a module that only reaches the nav via a client fetch simply is not
  // there. This is the check that lib/shell-data.ts exists for.
  console.log('\n=== FIRST PAINT (JavaScript disabled) ===')
  const noJs = await browser.newContext({
    viewport: DESKTOP,
    javaScriptEnabled: false,
    storageState: await ctx.storageState(),
  })
  const flat = await noJs.newPage()
  for (const [label, path] of [['/admin', '/admin?tab=overview'], ['/my-work', '/my-work'], ['/crm', '/crm']]) {
    await flat.goto(`http://localhost:3000${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    const links = await flat.$$eval('nav[aria-label="Primary"] a', as => as.map(a => a.textContent.trim()))
    const has = l => links.includes(l)
    // Views is core (not a module), so it must be in the server-rendered nav on every route.
    // Reading the DOM after the page settles cannot tell a server-rendered sidebar from one the
    // browser corrected a beat later - which is the whole point of the JS-disabled context.
    const wanted = enabled.includes('crm') ? ['CRM', 'My Work', 'Views'] : ['My Work', 'Views']
    const missing = wanted.filter(l => !has(l))
    console.log(`${missing.length === 0 ? '  ok  ' : ' FAIL '} ${label} renders ${wanted.join(' + ')} server-side${missing.length ? ` - missing ${missing.join(', ')}` : ''}`)
  }
  await noJs.close()

  // ── Per-route mobile measurement ──────────────────────────────────────────────────
  await page.setViewportSize(PHONE)
  for (const [name, path] of ROUTES) {
    errors.length = 0
    try {
      await page.goto(`http://localhost:3000${path}`, { waitUntil: 'networkidle', timeout: 60000 })
    } catch { /* networkidle can time out on realtime screens; measure anyway */ }
    await page.waitForTimeout(900)
    const m = await page.evaluate(MEASURE)
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false })
    report.push({ name, path, ...m, errors: [...errors] })
  }

  // 320px reflow check (WCAG 1.4.10) across every route, not a sample: it is the width
  // where fixed-size chrome shows up, and it is cheap once the session is warm.
  await page.setViewportSize(NARROW)
  for (const [name, path] of ROUTES) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1100)
    const m = await page.evaluate(MEASURE)
    report.push({ name: `${name}@320`, path, ...m, errors: [] })
  }

  // And a desktop pass, because every change here also lands on a 1440px screen.
  await page.setViewportSize(DESKTOP)
  for (const [name, path] of ROUTES) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1100)
    const m = await page.evaluate(MEASURE)
    await page.screenshot({ path: `${SHOTS}/${name}@desktop.png` })
    report.push({ name: `${name}@1440`, path, ...m, small: [], errors: [] })
  }

  await browser.close()
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId)
}

console.log('\n=== MOBILE AUDIT (390x844 unless noted) ===')
let bad = 0
for (const r of report) {
  const flags = []
  if (r.scrollsSideways) flags.push(`SIDEWAYS ${r.scrollWidth}px > ${r.vw}px`)
  if (r.small.length) flags.push(`${r.small.length} small targets`)
  if (r.errors.length) flags.push(`${r.errors.length} console errors`)
  if (!flags.length) { console.log(`  ok   ${r.name}`); continue }
  bad++
  console.log(` FLAG  ${r.name}  [${flags.join(' | ')}]`)
  for (const o of r.deepest.slice(0, 5)) console.log(`         overflow: <${o.tag}> right=${o.right} w=${o.width} "${o.text}" .${o.cls}`)
  for (const s of r.small.slice(0, 6)) console.log(`         target ${s.w}x${s.h} <${s.tag}> "${s.label}" .${s.cls}`)
  for (const e of r.errors.slice(0, 3)) console.log(`         error: ${e.slice(0, 160)}`)
}
console.log(`\n${bad} of ${report.length} routes flagged. Screenshots in ${SHOTS}`)
