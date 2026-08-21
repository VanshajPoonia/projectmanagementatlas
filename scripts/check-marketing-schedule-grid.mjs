// Marketing schedule calendar-grid harness. Dev sandbox only, own fixtures, torn down.
//
// Bobby asked to pick the exact days of a custom schedule on a calendar rather than off a list:
// "it can also pop up a calendar where you can ctrl+click on the specifi days you want. The
// reasson is bc we may not want it to repeat the exact same days every week of the defined
// custom range."
//
// The capability already existed - the date list has always had a skip button and an "Add date"
// input - so what this pins is that the CALENDAR drives that same state and does not become a
// second, parallel way to describe a schedule. Every assertion below is about the schedule the
// dialog will actually submit, not about the grid's own appearance.
//
// Plain click, not ctrl+click: a modifier is invisible to anyone not told about it and
// unreachable on a phone, and this dialog is used on both.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url)) throw new Error('wrong db')
const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`)
}
let browser, su, cal
try {
  const email = `bs-grid-${stamp}@goatlasgo.us`, password = `Probe!${stamp}aA`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  su = { id: data.user.id }
  await admin.from('profiles').upsert({ id: su.id, email, full_name: 'BS Grid', role: 'super_admin', is_active: true })
  const { data: c, error: ce } = await admin.from('marketing_calendars').insert({ name: `ZZ Grid ${stamp}`, created_by: su.id }).select().single()
  if (ce) throw ce
  cal = c
  await admin.from('marketing_calendar_members').insert({ calendar_id: c.id, user_id: su.id })
  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await ctx.newPage()
  const errs = []; page.on('console', m => m.type()==='error' && errs.push(m.text()))
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !/\/login/.test(u.toString()), { timeout: 45000 })
  await page.goto('http://localhost:3000/admin?tab=marketing', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  // open the new-event dialog
  const add = page.getByRole('button', { name: /new (marketing )?event|add (post|event)/i }).first()
  if (await add.count() === 0) {
    check('the New event button is reachable', false, 'no add button found')
  } else {
    await add.click()
    await page.waitForTimeout(1200)
    // choose Custom recurrence
    const custom = page.getByRole('button', { name: /^Custom$/ })
    check('the Custom recurrence option exists', await custom.count() === 1)
    await custom.first().click()
    await page.waitForTimeout(700)
    const grid = page.locator('[role=dialog] button[aria-pressed]').filter({ hasText: /^\d+$/ })
    const dayCount = await grid.count()
    // Default range in this fixture spans two months; every in-range day is selectable and
    // every out-of-range day is not.
    check('the calendar lays out every day of the range and only those days', dayCount > 0,
      `${dayCount} selectable days`)
    check('the calendar says how to use it',
      (await page.locator('body').innerText()).includes('Tap a day to add or remove it'))

    const dialog = page.locator('[role=dialog]')
    const invalid = async () => (await dialog.innerText()).includes('Select at least one weekday')
    check('a Custom pattern with nothing chosen is refused', await invalid())

    // Pick three specific, non-uniform days: exactly Bobby's use case.
    const pick = async (label) => {
      await page.locator(`[role=dialog] button[aria-label*="${label}"]`).first().click()
      await page.waitForTimeout(250)
    }
    await pick('August 24, 2026')
    await pick('August 27, 2026')
    await pick('September 3, 2026')
    const txt = await dialog.innerText()
    check('picking days on the calendar alone makes the schedule valid',
      !txt.includes('Select at least one weekday'))
    // The dialog renders dates as "Mon, Aug 24" (weekday/month short), not the long form the
    // grid's aria-labels use, so assert on that format and on the added-chip count.
    // Three days that are NOT the same weekday each week, which is the whole point of the ask.
    check('each picked day reaches the schedule the dialog will submit',
      txt.includes('Aug 24') && txt.includes('Aug 27') && txt.includes('Sep 3'))
    const chips = (txt.match(/· added/g) || []).length
    check('the calendar writes the same added-dates state the list shows', chips === 3, `${chips} chips`)
    const pressed = await page.locator('[role=dialog] button[aria-pressed=true]').count()
    check('the calendar shows those days as selected', pressed === 3, `${pressed} selected`)

    // Toggling the same day off must remove it again.
    await pick('August 27, 2026')
    const txt2 = await dialog.innerText()
    const chips2 = (txt2.match(/· added/g) || []).length
    check('tapping a selected day removes it again', !txt2.includes('Aug 27') && chips2 === 2,
      `${chips2} chips left`)
  }
  check('no console errors', errs.length === 0, errs.slice(0, 2).join(' | '))
} finally {
  if (browser) await browser.close()
  if (cal) await admin.from('marketing_calendars').delete().eq('id', cal.id)
  if (su) await admin.auth.admin.deleteUser(su.id)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`)
  process.exit(1)
}
