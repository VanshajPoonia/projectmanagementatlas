// Marketing channel columns: renaming one from the grid header. Dev sandbox only.
//
// pnpm check:marketing-channels already pins the RPC and its policies at the database. This
// is the other half, and it is the half that has been wrong before in this repo: migration
// 105 gave the calendar a rename path in September and the grid header never offered it, so
// the only route to it was a dialog behind "Edit channels" that nothing on the grid pointed
// at. A rename you cannot reach is a rename that does not exist (CLAUDE.md, three times).
//
// It also pins the one interaction that renaming inside a draggable <th> can break: a column
// header is draggable, and selecting text with the mouse inside its input looks exactly like
// the start of a drag, so the header must stop being draggable while it is being edited.
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

let browser, userId, channelId
const email = `mkt-${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`

try {
  const { data: created, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (ue) throw ue
  userId = created.user.id
  await admin.from('profiles').upsert({ id: userId, email, full_name: 'Channel UI', role: 'super_admin', is_active: true })

  // A throwaway channel of our own, so the pass never renames a real column and never has to
  // put one back. Positioned last so it cannot disturb the existing grid order.
  const { data: existing } = await admin.from('marketing_channels').select('position')
  const nextPosition = existing.reduce((max, c) => Math.max(max, c.position ?? -1), -1) + 1
  const original = `ZZ Probe ${stamp}`
  const { data: ch, error: ce } = await admin
    .from('marketing_channels')
    .insert({ channel: original, label: original, position: nextPosition })
    .select()
    .single()
  if (ce) throw ce
  channelId = ch.id

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
  await page.getByRole('button', { name: 'Channels', exact: true }).click()
  const header = page.getByRole('columnheader', { name: new RegExp(`^${original} column`) })
  await header.waitFor({ state: 'visible', timeout: 15000 })

  check('the channel column header is a rename control, not just a label',
    await header.getByRole('button', { name: `Rename ${original}` }).count() === 1)

  check('the header is draggable while it is not being edited',
    await header.getAttribute('draggable') === 'true')

  await header.getByRole('button', { name: `Rename ${original}` }).click()
  const input = header.getByRole('textbox', { name: `Rename ${original}` })
  await input.waitFor({ state: 'visible', timeout: 5000 })

  check('the header stops being draggable while it is being edited',
    await header.getAttribute('draggable') === 'false',
    'otherwise selecting text in the input picks the whole column up')

  // Escape abandons the edit without writing anything.
  await input.fill(`Discarded ${stamp}`)
  await input.press('Escape')
  const afterEscape = await admin.from('marketing_channels').select('label').eq('id', channelId).single()
  check('Escape abandons the edit and writes nothing', afterEscape.data.label === original, afterEscape.data.label)

  // Enter commits it.
  const renamed = `ZZ Renamed ${stamp}`
  await header.getByRole('button', { name: `Rename ${original}` }).click()
  const input2 = header.getByRole('textbox', { name: `Rename ${original}` })
  await input2.waitFor({ state: 'visible', timeout: 5000 })
  await input2.fill(renamed)
  await input2.press('Enter')
  await page.getByRole('columnheader', { name: new RegExp(`^${renamed} column`) }).waitFor({ state: 'visible', timeout: 15000 })

  check('the grid header shows the new name without a reload', true)

  const after = await admin.from('marketing_channels').select('channel, label').eq('id', channelId).single()
  check('the rename reached the database', after.data.label === renamed, after.data.label)
  // 105's rule: the stored value and the display label are kept equal on rename, so events
  // stay filed under the name that is on screen.
  check('the stored channel value moved with the label, so no event is orphaned',
    after.data.channel === renamed, after.data.channel)

  check('no console errors during the pass', errors.length === 0, errors.slice(0, 2).join(' | '))
} catch (e) {
  check('harness completed without throwing', false, e.message)
  console.error(e)
} finally {
  try {
    if (channelId) await admin.from('marketing_channels').delete().eq('id', channelId)
    if (userId) await admin.auth.admin.deleteUser(userId)
  } catch (e) { console.error('cleanup:', e.message) }
  if (browser) await browser.close()
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}
