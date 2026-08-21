// Which calendar the Marketing tab opens on. Dev sandbox only.
//
// The switcher used to default to `activeCalendars[0]`, and that list is ordered by name, so
// the default was decided by the alphabet. On production that put every visit on "Kayla's
// Personal" - an empty calendar with no members at all, visible only because an admin reads
// every calendar through the SELECT policy - and the switcher forgot the correction on the
// next visit. This is the half a database harness cannot see: the policy was right the whole
// time and the screen still opened on the wrong calendar (CLAUDE.md, several times over).
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

let browser, userId
const created = []
const email = `caldefault-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`

// Named so the empty one sorts first and the joined one sorts last, whatever else is on the
// sandbox - the old rule picks the first, the new rule has to reach past it to the last.
const EMPTY = `AAA Probe Empty ${stamp}`
const JOINED = `ZZZ Probe Joined ${stamp}`
// Neither the alphabetically-first calendar nor the one membership resolves to, so switching
// to it is a real change under the old rule as well as the new one. Without a third calendar
// the memory check passes vacuously against the very behaviour it exists to catch.
const OTHER = `MMM Probe Other ${stamp}`

const makeCalendar = async (name, color) => {
  const { data, error } = await admin.from('marketing_calendars')
    .insert({ name, color, created_by: userId }).select().single()
  if (error) throw error
  created.push(data.id)
  return data.id
}

try {
  const { data: acct, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ue) throw ue
  userId = acct.user.id
  await admin.from('profiles').upsert({ id: userId, email, full_name: 'Calendar Default', role: 'super_admin', is_active: true })

  const emptyId = await makeCalendar(EMPTY, '#ef0b79')
  const otherId = await makeCalendar(OTHER, '#22c55e')
  const joinedId = await makeCalendar(JOINED, '#3b82f6')
  // Only the second one gets a membership row. The first is the shape of a personal calendar
  // somebody else made and never shared, which is what production actually has.
  const { error: me } = await admin.from('marketing_calendar_members')
    .insert({ calendar_id: joinedId, user_id: userId })
  if (me) throw me

  browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !/\/login/.test(u.toString()), { timeout: 45000 })

  await page.goto(`${BASE}/admin?tab=marketing`, { waitUntil: 'networkidle' })
  const select = page.getByLabel('Select calendar')
  await select.waitFor({ state: 'visible', timeout: 20000 })

  // Prove the test is meaningful before asserting on it: if the empty calendar were not the
  // one the old rule picks, a pass here would mean nothing.
  const options = await select.locator('option').allTextContents()
  check('the empty calendar really is the one that sorts first',
    options[0] === EMPTY, options.slice(0, 3).join(' | '))

  const openedOn = await select.inputValue()
  check('opens the calendar this user is a member of, not whichever sorts first',
    openedOn === joinedId, openedOn === emptyId ? 'opened the empty one' : openedOn)

  check('the heading names the calendar that is actually loaded',
    await page.getByRole('heading', { name: JOINED }).count() === 1)

  // A deliberate switch has to survive a reload - forgetting it was half the reported bug.
  await select.selectOption(otherId)
  await page.getByRole('heading', { name: OTHER }).waitFor({ state: 'visible', timeout: 15000 })
  await page.goto(`${BASE}/admin?tab=marketing`, { waitUntil: 'networkidle' })
  await select.waitFor({ state: 'visible', timeout: 20000 })

  check('remembers the calendar the user switched to across a reload',
    await select.inputValue() === otherId, await select.inputValue())

  // ...but a remembered calendar that gets archived must fall through, not blank the screen.
  await admin.from('marketing_calendars').update({ is_archived: true }).eq('id', otherId)
  await page.goto(`${BASE}/admin?tab=marketing`, { waitUntil: 'networkidle' })
  await select.waitFor({ state: 'visible', timeout: 20000 })

  check('falls through to a reachable calendar when the remembered one is archived',
    await select.inputValue() === joinedId, await select.inputValue())
  check('the archived calendar is gone from the switcher',
    !(await select.locator('option').allTextContents()).includes(OTHER))

  check('no console errors during the pass', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('harness completed without throwing', false, e.message)
  console.error(e)
} finally {
  try {
    for (const id of created) {
      await admin.from('marketing_calendar_members').delete().eq('calendar_id', id)
      await admin.from('marketing_calendars').delete().eq('id', id)
    }
    if (userId) await admin.auth.admin.deleteUser(userId)
  } catch (e) { console.error('cleanup:', e.message) }
  if (browser) await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
