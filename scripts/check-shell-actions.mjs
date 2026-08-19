#!/usr/bin/env node
// Prompt A/B browser gate: the board command palette's context actions, and the guest
// comment path.
//
// These two are here rather than in a unit test because neither can be proven anywhere
// else. The palette's command builders are pure and unit-tested, but "does ⌘K actually
// open over a task modal, and does the command it runs reach the database" is a question
// only a browser answers - and the palette used to render one dialog inside another,
// which is exactly the shape that breaks silently. The guest comment is here because
// lib/capabilities.ts and Postgres disagreed about it for months while nothing rendered
// either answer; the only convincing proof is a real guest session posting a real comment.
//
// Needs a dev server on :3117 (`npx next dev -p 3117`) and the dev sandbox. Creates its own
// fixtures and removes them. Run: pnpm check:shell-actions
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const BASE = 'http://localhost:3117'
assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const made = { users: [], boards: [] }
let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${!ok && detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

async function person(label, role) {
  const email = `browser-${label}-${stamp}@goatlasgo.us`
  const password = `Browser-${stamp}-x9!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(error.message)
  made.users.push(data.user.id)
  await admin.from('profiles').upsert({ id: data.user.id, email, full_name: `Browser ${label}`, role }, { onConflict: 'id' })
  return { id: data.user.id, email, password }
}

async function signIn(page, who) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 })
}

const browser = await chromium.launch()
try {
  const owner = await person('owner', 'admin')
  const guest = await person('guest', 'user')

  const { data: board } = await admin.from('boards')
    .insert({ title: `Palette ${stamp}`, created_by: owner.id, updated_by: owner.id, is_private: false })
    .select('id, title').single()
  made.boards.push(board.id)
  const cols = []
  for (const [i, [title, key]] of [['To Do', 'to_do'], ['In Progress', 'in_progress'], ['Done', 'done']].entries()) {
    const { data: c } = await admin.from('columns')
      .insert({ board_id: board.id, title, position: i, status_key: key }).select('id, title').single()
    cols.push(c)
  }
  const { data: task } = await admin.from('tasks')
    .insert({ column_id: cols[0].id, title: `Palette task ${stamp}`, created_by: owner.id, position: 0, visibility: 'board', priority: 3 })
    .select('id').single()
  await admin.from('board_members').insert({ board_id: board.id, user_id: guest.id, role: 'guest' })

  // ── 1. Admin: the board palette exists and carries context actions ──────────────
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await signIn(page, owner)
  await page.goto(`${BASE}/admin/board/${board.id}`)
  await page.waitForSelector('text=Palette task', { timeout: 20000 })

  const paletteButton = page.locator('button[aria-label="Open the command palette"]')
  check('board page has a visible palette entry point', await paletteButton.count() === 1)

  await page.keyboard.press('Meta+k')
  await page.waitForSelector('[cmdk-dialog], [role="dialog"]', { timeout: 8000 })
  const dialogText = async () => (await page.locator('[role="dialog"]').last().innerText()).replace(/\s+/g, ' ')
  let text = await dialogText()
  check('⌘K opens the palette on a board', text.length > 0)
  check('project-context: create work item', text.includes('Create work item'), text.slice(0, 250))
  check('project-context: filter', text.includes('Filter this board'))
  check('project-context: members', text.includes('Manage who has access'))
  check('project-context: board settings', text.includes('Board settings'))
  check('no saved-view stub is offered', !text.toLowerCase().includes('saved view'))
  await page.keyboard.press('Escape')

  // ── 2. Work-item context actions appear only with a task open ──────────────────
  // NB: clicking the card TITLE starts inline rename and stops propagation, so the detail
  // is opened from the card's own body - the "View activity" control is the deterministic
  // one, and it exercises the same onOpenDetail path the board now owns.
  await page.click('button[aria-label="View activity"]')
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await page.waitForTimeout(900)
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(700)
  text = await dialogText()
  check('palette stacks over the open task modal', text.includes('Move to:') || text.includes('Set priority'), text.slice(0, 200))
  check('work-item: change state', text.includes('Move to: In Progress'))
  check('work-item: change priority', text.includes('Set priority'))
  check('work-item: assign', text.includes('Assign this work item'))
  check('work-item: labels', text.includes('Add or remove a label'))
  check('work-item: copy link', text.includes('Copy link to this work item'))
  check('does not offer the column the task is already in', !text.includes('Move to: To Do'))

  // ── 3. A palette command really writes ─────────────────────────────────────────
  await page.click('text=Move to: In Progress')
  await page.waitForTimeout(2500)
  const { data: moved } = await admin.from('tasks').select('column_id, status').eq('id', task.id).single()
  check('a palette move actually moved the task in the database',
    moved?.column_id === cols[1].id && moved?.status === 'in_progress',
    `column=${moved?.column_id} status=${moved?.status}`)

  check('no console errors on the board', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()

  // ── 4. Guest: comment box is usable (B1), edit controls are not ────────────────
  const gctx = await browser.newContext()
  const gpage = await gctx.newPage()
  await signIn(gpage, guest)
  await gpage.goto(`${BASE}/dashboard/board/${board.id}`)
  await gpage.waitForSelector(`text=Palette task ${stamp}`, { timeout: 20000 })
  await gpage.click('button[aria-label="View activity"]')
  await gpage.waitForSelector('[role="dialog"]', { timeout: 10000 })
  await gpage.waitForTimeout(900)
  // That control lands on the Activity tab; the comment box lives on Comments.
  await gpage.click('[role="tab"]:has-text("Comments")')
  await gpage.waitForTimeout(700)

  const commentBox = gpage.locator('input[placeholder="Write a comment..."]')
  check('guest sees the comment box', await commentBox.count() === 1)
  check('guest comment box is ENABLED (it was grouped with task.edit)', await commentBox.isDisabled() === false)

  const titleInput = gpage.locator('#title, input#title')
  if (await titleInput.count() > 0) {
    check('guest title field is still disabled', await titleInput.first().isDisabled() === true)
  }

  await commentBox.fill(`guest comment ${stamp}`)
  await commentBox.press('Enter')
  await gpage.waitForTimeout(2500)
  const { data: comments } = await admin.from('task_comments').select('id, comment').eq('task_id', task.id)
  check('the guest comment reached the database',
    (comments ?? []).some(c => c.comment?.includes(`guest comment ${stamp}`)),
    JSON.stringify(comments))
  await gctx.close()
} catch (err) {
  console.error('\nTHREW:', err?.message ?? err)
  failures++
} finally {
  await browser.close()
  for (const b of made.boards) await admin.from('boards').delete().eq('id', b)
  for (const u of made.users) await admin.auth.admin.deleteUser(u)
  console.log('cleaned up fixtures.')
  console.log(failures === 0 ? '\nAll browser checks passed.' : `\n${failures} browser check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}
