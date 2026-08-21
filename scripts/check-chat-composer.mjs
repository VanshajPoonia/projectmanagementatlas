// Chat composer: multi-paragraph messages survive being typed and sent. Dev sandbox only.
//
// The bug this pins (V's TaskApp MACD, task ccb3d8e6): the composer was a single-line
// <Input>, and the HTML spec's value sanitization algorithm for input[type=text] STRIPS every
// CR and LF from the value. So pasting several paragraphs silently collapsed them into one
// run-on block before anything was sent, which is what "it truncates when it's posted" looked
// like. The database column is TEXT and the message bubble has always carried
// whitespace-pre-wrap, so neither of those was ever the cause - only the input element was.
//
// Nothing here can be checked by reading the component: whether a newline survives depends on
// the element type the browser applies its sanitizer to.
import { chromium, devices } from 'playwright'
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

let browser
const sender = { email: `chat-a-${stamp}@goatlasgo.us`, password: `Probe!${stamp}aA`, id: null }
const recipient = { email: `chat-b-${stamp}@goatlasgo.us`, password: `Probe!${stamp}bB`, id: null }

const openChat = async (page, name) => {
  await page.goto(`${BASE}/admin?tab=chat`, { waitUntil: 'networkidle' })
  const picker = page.locator('button[role=combobox]').first()
  await picker.waitFor({ state: 'visible', timeout: 20000 })
  await picker.click()
  await page.getByRole('option', { name: new RegExp(name) }).click()
  const box = page.getByPlaceholder(/Type a message/)
  await box.waitFor({ state: 'visible', timeout: 15000 })
  return box
}

try {
  for (const u of [sender, recipient]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
    })
    if (error) throw error
    u.id = data.user.id
    await admin.from('profiles').upsert({
      id: u.id, email: u.email, full_name: u === sender ? `Sender ${stamp}` : `Recipient ${stamp}`,
      role: 'admin', is_active: true,
    })
  }

  browser = await chromium.launch()

  /* ── desktop: keyboard rules ─────────────────────────────────────── */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('button[type=submit]').waitFor({ state: 'visible' })
  await page.fill('input[type=email]', sender.email)
  await page.fill('input[type=password]', sender.password)
  await page.click('button[type=submit]')
  await page.waitForURL(u => !/\/login/.test(u.toString()), { timeout: 45000 })

  const box = await openChat(page, `Recipient ${stamp}`)

  check(
    'the composer is a textarea, not a single-line input',
    await box.evaluate(el => el.tagName.toLowerCase()) === 'textarea',
    `got <${await box.evaluate(el => el.tagName.toLowerCase())}>`,
  )

  const startHeight = await box.evaluate(el => el.getBoundingClientRect().height)

  // Type the shape of Bobby's report: several paragraphs, separated by blank lines.
  await box.click()
  await box.type('Paragraph one.')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await box.type('Paragraph two.')

  const typed = await box.inputValue()
  check(
    'Shift+Enter types a newline instead of sending',
    typed === 'Paragraph one.\n\nParagraph two.',
    JSON.stringify(typed),
  )
  check(
    'the message is still in the composer, not sent',
    await page.locator('text=Paragraph two.').count() === 1,
  )

  const grownHeight = await box.evaluate(el => el.getBoundingClientRect().height)
  check(
    'the composer grows with the content so the whole message is visible while typing',
    grownHeight > startHeight,
    `${Math.round(startHeight)}px -> ${Math.round(grownHeight)}px`,
  )
  check(
    'the whole message is visible, not scrolled out of view',
    await box.evaluate(el => el.scrollHeight <= el.clientHeight + 1),
  )

  // A very long message must scroll inside the box rather than push the message list away.
  const before = await box.evaluate(el => el.getBoundingClientRect().height)
  await box.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(150)
  const capped = await box.evaluate(el => el.getBoundingClientRect().height)
  check(
    'a very long message caps the composer height instead of eating the page',
    capped <= 200 && capped > before,
    `${Math.round(capped)}px`,
  )

  // Back to the real message, then send with Enter.
  await box.evaluate(el => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await box.click()
  await box.type('Paragraph one.')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await box.type('Paragraph two.')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2000)

  check('Enter sends the message', (await box.inputValue()) === '', `composer left: ${JSON.stringify(await box.inputValue())}`)

  const { data: rows } = await admin
    .from('chat_messages')
    .select('message')
    .eq('sender_id', sender.id)
    .eq('recipient_id', recipient.id)
  const stored = rows?.[0]?.message ?? ''
  check('the message reached the database', rows?.length === 1, `${rows?.length ?? 0} row(s)`)
  check(
    'the paragraph breaks survive the send - the original bug',
    stored === 'Paragraph one.\n\nParagraph two.',
    JSON.stringify(stored),
  )

  const bubble = page.locator('p.whitespace-pre-wrap', { hasText: 'Paragraph one.' }).first()
  await bubble.waitFor({ state: 'visible', timeout: 15000 })
  check(
    'the posted message renders both paragraphs, not one run-on block',
    (await bubble.textContent())?.includes('Paragraph one.')
      && (await bubble.textContent())?.includes('Paragraph two.'),
  )
  check(
    'the posted bubble is taller than one line, so nothing is clipped',
    await bubble.evaluate(el => el.getBoundingClientRect().height > 30),
  )

  check('no console errors on the chat surface', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  /* ── touchscreen: Enter must type a newline, never send ──────────── */
  const touch = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true })
  const mpage = await touch.newPage()
  await mpage.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await mpage.fill('input[type=email]', sender.email)
  await mpage.fill('input[type=password]', sender.password)
  await mpage.click('button[type=submit]')
  await mpage.waitForURL(u => !/\/login/.test(u.toString()), { timeout: 45000 })

  check(
    'the emulated phone really does report a coarse pointer',
    await mpage.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
  )

  const mbox = await openChat(mpage, `Recipient ${stamp}`)
  await mbox.click()
  await mbox.type('Thumb line one.')
  await mpage.keyboard.press('Enter')
  await mpage.waitForTimeout(800)
  const thumbValue = await mbox.inputValue()
  check(
    'Enter types a newline on a touchscreen instead of sending',
    thumbValue === 'Thumb line one.\n',
    JSON.stringify(thumbValue),
  )

  const { count } = await admin
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', sender.id)
  check('nothing was sent by that Enter', count === 1, `${count} message(s) total`)
  await touch.close()
} finally {
  if (browser) await browser.close()
  for (const u of [sender, recipient]) {
    if (!u.id) continue
    await admin.from('chat_messages').delete().or(`sender_id.eq.${u.id},recipient_id.eq.${u.id}`)
    await admin.from('profiles').delete().eq('id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) process.exit(1)
