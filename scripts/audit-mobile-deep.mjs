// The heavy screens the route sweep can't reach by URL alone: a board's kanban, the task
// detail modal, and the marketing calendar. Dev sandbox only.
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!/pxzpewaerhjwnwsbaklc/.test(url)) throw new Error(`refusing to run against ${url}`)

const SHOTS = process.env.SHOT_DIR || '/tmp/mobile-audit'
mkdirSync(SHOTS, { recursive: true })

const admin = createClient(url, service, { auth: { persistSession: false } })
const stamp = Date.now()
const email = `deep${stamp}@goatlasgo.us`
const password = `Probe!${stamp}aA`

let userId
try {
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  userId = created.user.id
  await admin.from('profiles').upsert({ id: userId, email, full_name: 'Deep Audit', role: 'super_admin', is_active: true })

  // The busiest live board, so the kanban is measured with real columns and real cards.
  const { data: cols } = await admin.from('columns').select('id, board_id, board:boards!inner(id, title, archived_at)')
  const live = cols.filter(c => c.board && !c.board.archived_at)
  const { data: allTasks } = await admin.from('tasks').select('id, title, column_id').is('deleted_at', null)
  const perBoard = new Map()
  for (const t of allTasks) {
    const c = live.find(x => x.id === t.column_id)
    if (!c) continue
    if (!perBoard.has(c.board_id)) perBoard.set(c.board_id, [])
    perBoard.get(c.board_id).push(t)
  }
  const [boardId, boardTasks] = [...perBoard.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  const task = boardTasks[0]
  console.log('board', boardId, `(${boardTasks.length} tasks)`, '| task', task.title)

  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()

  await page.goto('http://localhost:3000/login')
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 60000 })

  const measure = async (name) => {
    await page.waitForTimeout(1400)
    const m = await page.evaluate(`(() => {
      const vw = document.documentElement.clientWidth
      return { vw, sw: document.documentElement.scrollWidth, sideways: document.documentElement.scrollWidth > vw + 1 }
    })()`)
    await page.screenshot({ path: `${SHOTS}/${name}.png` })
    console.log(`${m.sideways ? ' FLAG ' : '  ok  '} ${name}  ${m.sw}px / ${m.vw}px`)
  }

  await page.goto(`http://localhost:3000/admin/board/${boardId}`, { waitUntil: 'domcontentloaded' })
  await measure('board-kanban')

  // Open the first task card.
  const card = await page.$('[data-task-card], [role="button"]')
  await page.getByText(task.title, { exact: false }).first().click({ timeout: 15000 }).catch(() => {})
  await measure('task-detail-modal')
  await page.keyboard.press('Escape')

  await page.goto('http://localhost:3000/admin?tab=marketing', { waitUntil: 'domcontentloaded' })
  await measure('marketing-calendar')

  await page.goto('http://localhost:3000/admin?tab=reports', { waitUntil: 'domcontentloaded' })
  await measure('reports-table')

  await page.goto('http://localhost:3000/admin?tab=chat', { waitUntil: 'domcontentloaded' })
  await measure('chat')

  // A real dialog at phone width. globals.css used to clamp these to 90vh with `!important`
  // and no overflow rule, so anything taller was cut off with its submit button out of reach.
  await page.goto('http://localhost:3000/admin?tab=boards', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: /new board/i }).first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 })
  await measure('dialog-new-board')
  const box = await page.evaluate(`(() => {
    const d = document.querySelector('[role="dialog"]')
    const r = d.getBoundingClientRect(), cs = getComputedStyle(d)
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left),
             right: Math.round(r.right), overflowY: cs.overflowY, vh: innerHeight, vw: innerWidth,
             scrollable: d.scrollHeight > d.clientHeight + 1 }
  })()`)
  const inside = box.top >= -1 && box.bottom <= box.vh + 1 && box.left >= -1 && box.right <= box.vw + 1
  console.log(`${inside ? '  ok  ' : ' FLAG '} dialog fits the viewport  ${JSON.stringify(box)}`)
  console.log(`${box.overflowY === 'auto' ? '  ok  ' : ' FLAG '} dialog body can scroll (overflow-y: ${box.overflowY})`)
  await page.keyboard.press('Escape')

  // Dark mode, because the accent/theme tokens are what most of these classes resolve through.
  await page.evaluate(`localStorage.setItem('theme', 'dark')`)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('http://localhost:3000/crm/orders', { waitUntil: 'domcontentloaded' })
  await measure('crm-orders-dark')
  await page.goto('http://localhost:3000/admin?tab=overview', { waitUntil: 'domcontentloaded' })
  await measure('admin-home-dark')

  await browser.close()
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId)
}
