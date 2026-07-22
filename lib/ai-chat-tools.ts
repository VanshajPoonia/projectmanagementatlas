// Read-only data tools the AI chat assistant can call (Gemini function-calling).
//
// Every executor here runs on the request-scoped Supabase client (the same
// one the rest of the app uses), never a service-role client — so RLS is
// always the real enforcement, not app code. That's what makes "admins see
// everything, users see what they're allowed to" work almost for free:
// tasks/boards RLS already grants that split, and personal_tasks RLS has no
// admin clause at all (see scripts/030_create_personal_tasks.sql), so it's
// owner-only here too, automatically.
//
// One gap RLS does NOT cover: `tasks`/`columns` policies allow any
// authenticated user to read every row, regardless of a board's is_private
// flag (only `boards` itself enforces that). get_tasks below closes that
// gap manually by cross-referencing against the caller's RLS-correct visible
// board list before returning anything.

import { getAssigneeNames, isTaskOwnedBy } from './assignees'
import { getNormalizedTaskStatus, getTaskStatusLabel } from './task-status'

export interface ToolContext {
  supabase: any
  userId: string
}

export const AI_CHAT_TOOLS = [
  {
    name: 'get_tasks',
    description:
      "Lists tasks from the team's Kanban boards — title, status, priority, due date, board, assignees. Use for questions about tasks, what's due, overdue work, or a specific board's contents. Subtasks are included; they carry a `parent_task` field naming the task they belong to, and should be described in relation to it.",
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['mine', 'all'],
          description: "'mine' (default): tasks assigned to or created by the current user. 'all': every visible task.",
        },
        status: {
          type: 'string',
          enum: ['to_do', 'in_progress', 'done', 'overdue'],
          description: '"overdue" means past its due date and not done.',
        },
        due_after: { type: 'string', description: 'ISO date YYYY-MM-DD. Only tasks due on/after this date.' },
        due_before: { type: 'string', description: 'ISO date YYYY-MM-DD. Only tasks due on/before this date.' },
        board_title: { type: 'string', description: 'Only tasks on boards whose title contains this text.' },
        limit: { type: 'number', description: 'Max tasks to return. Default 25, max 50.' },
      },
    },
  },
  {
    name: 'get_boards',
    description: 'Lists the Kanban boards visible to the current user, with each board\'s columns.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_personal_tasks',
    description: "Lists the current user's own private personal to-do list. Nobody else, including admins, can see these.",
    parameters: {
      type: 'object',
      properties: {
        include_done: { type: 'boolean', description: 'Include already-completed items. Default false.' },
      },
    },
  },
  {
    name: 'get_marketing_calendar',
    description:
      'Lists marketing content-calendar entries (posting date, channel, content, company). Returns nothing for users with no marketing calendar access.',
    parameters: {
      type: 'object',
      properties: {
        date_after: { type: 'string', description: 'ISO date YYYY-MM-DD. Default: today.' },
        date_before: { type: 'string', description: 'ISO date YYYY-MM-DD. Default: 30 days out.' },
        company_code: { type: 'string', description: 'Filter to one company by code, e.g. "SRG" or "AGC".' },
        limit: { type: 'number', description: 'Max items to return. Default 40, max 100.' },
      },
    },
  },
]

async function getTasks(ctx: ToolContext, args: any) {
  const { supabase, userId } = ctx
  const limit = Math.min(Math.max(Number(args?.limit) || 25, 1), 50)

  const { data: visibleBoards } = await supabase.from('boards').select('id, title').is('archived_at', null)
  const boardTitleById = new Map<string, string>((visibleBoards ?? []).map((b: any) => [b.id, b.title]))

  const { data: rows, error } = await supabase
    .from('tasks')
    .select(
      'id, title, status, priority, due_date, created_by, assigned_to, parent_task_id, task_assignees(user_id), column:columns(board_id, title)'
    )
    .is('deleted_at', null)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(200)
  if (error) return { error: error.message }

  const { data: profiles } = await supabase.from('profiles').select('id, full_name, email')
  const profileList = profiles ?? []

  const now = new Date()
  const dueAfter = args?.due_after ? new Date(args.due_after) : null
  const dueBefore = args?.due_before ? new Date(args.due_before) : null
  const boardTitleFilter = typeof args?.board_title === 'string' ? args.board_title.toLowerCase() : null

  const tasks = (rows ?? [])
    .filter((t: any) => t.column?.board_id && boardTitleById.has(t.column.board_id))
    .filter((t: any) => {
      // Same ownership rule as both dashboards, so the assistant's "my tasks" and the
      // user's own screen never disagree.
      if (args?.scope !== 'all' && !isTaskOwnedBy(t, userId)) return false
      if (args?.status === 'overdue') {
        const overdue = t.due_date && new Date(t.due_date) < now && getNormalizedTaskStatus(t) !== 'done'
        if (!overdue) return false
      } else if (args?.status && getNormalizedTaskStatus(t) !== args.status) {
        return false
      }
      if (dueAfter && (!t.due_date || new Date(t.due_date) < dueAfter)) return false
      if (dueBefore && (!t.due_date || new Date(t.due_date) > dueBefore)) return false
      if (boardTitleFilter && !boardTitleById.get(t.column.board_id)?.toLowerCase().includes(boardTitleFilter)) return false
      return true
    })
    .slice(0, limit)

  // Parent titles are fetched separately rather than embedded: parent_task_id is a
  // self-referencing foreign key (where PostgREST's `!hint` is ambiguous about
  // direction), and the 200-row window above can easily exclude a subtask's parent,
  // which would leave the breadcrumb null even if the embed did resolve correctly.
  const parentIds = Array.from(new Set(tasks.map((t: any) => t.parent_task_id).filter(Boolean)))
  const parentTitleById = new Map<string, string>()
  if (parentIds.length > 0) {
    const { data: parentRows } = await supabase.from('tasks').select('id, title').in('id', parentIds)
    for (const row of parentRows ?? []) parentTitleById.set(row.id, row.title)
  }

  const result = tasks.map((t: any) => ({
    id: t.id,
    title: t.title,
    status: getTaskStatusLabel(t),
    priority: t.priority,
    due_date: t.due_date,
    board: boardTitleById.get(t.column.board_id),
    assignees: getAssigneeNames(t, profileList),
    // Present only on subtasks, so the assistant can say "the 'Send draft' subtask
    // of 'Q3 launch'" instead of quoting a title that reads as standalone work.
    ...(t.parent_task_id ? { parent_task: parentTitleById.get(t.parent_task_id) ?? null } : {}),
  }))

  return { count: result.length, tasks: result }
}

async function getBoards(ctx: ToolContext) {
  const { supabase } = ctx
  const { data, error } = await supabase
    .from('boards')
    .select('id, title, description, is_private, columns(title)')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) return { error: error.message }

  return {
    boards: (data ?? []).map((b: any) => ({
      title: b.title,
      description: b.description,
      private: b.is_private,
      columns: (b.columns ?? []).map((c: any) => c.title),
    })),
  }
}

async function getPersonalTasks(ctx: ToolContext, args: any) {
  const { supabase, userId } = ctx
  let query = supabase
    .from('personal_tasks')
    .select('id, title, description, due_date, is_done')
    .eq('user_id', userId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(50)
  if (!args?.include_done) query = query.eq('is_done', false)

  const { data, error } = await query
  if (error) return { error: error.message }
  return { tasks: data ?? [] }
}

async function getMarketingCalendar(ctx: ToolContext, args: any) {
  const { supabase } = ctx
  const dateAfter = typeof args?.date_after === 'string' ? args.date_after : new Date().toISOString().slice(0, 10)
  const defaultBefore = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const dateBefore = typeof args?.date_before === 'string' ? args.date_before : defaultBefore
  const limit = Math.min(Math.max(Number(args?.limit) || 40, 1), 100)

  const { data, error } = await supabase
    .from('marketing_calendar_items')
    .select('date, day_label, channel, content, is_highlighted, marketing_calendar_item_companies(company:companies(code, name))')
    .gte('date', dateAfter)
    .lte('date', dateBefore)
    .order('date', { ascending: true })
    .limit(limit * 3)
  if (error) return { error: error.message }

  const companyFilter = typeof args?.company_code === 'string' ? args.company_code.toUpperCase() : null
  const items = (data ?? [])
    .map((row: any) => ({
      date: row.date,
      day: row.day_label,
      channel: row.channel,
      content: row.content,
      highlighted: row.is_highlighted,
      companies: (row.marketing_calendar_item_companies ?? []).map((r: any) => r.company?.code).filter(Boolean),
    }))
    .filter((item: any) => !companyFilter || item.companies.includes(companyFilter))
    .slice(0, limit)

  return { count: items.length, items }
}

// ── Internet tools (only exposed in 'web' mode) ───────────────────────────────
// These don't touch Supabase/RLS — they reach the public internet. They're kept
// separate from the data tools and only handed to the model in 'web' mode so the
// two intents (your private workspace data vs. the open web) never mix in one turn.

export const WEB_TOOLS = [
  {
    name: 'web_search',
    description:
      'Search the public web for current, real-world information (news, facts, docs, prices, how-tos). Use this whenever the answer depends on up-to-date or external knowledge rather than the user\'s workspace. Returns a short answer plus source results with links.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' },
        max_results: { type: 'number', description: 'How many results to return (1-8, default 5).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description:
      'Fetch the readable text of one specific public web page by its URL, when the user pastes a link or a search result needs to be read in full. Public http(s) pages only.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL of a public web page.' },
      },
      required: ['url'],
    },
  },
]

export type ChatMode = 'workspace' | 'web'

// Which function declarations the model sees, per mode. Files/images are passed as
// input parts regardless of mode, so they aren't gated here.
export function toolsForMode(mode: ChatMode) {
  return mode === 'web' ? WEB_TOOLS : AI_CHAT_TOOLS
}

async function webSearch(args: any) {
  const key = process.env.TAVILY_API_KEY
  if (!key) {
    return { error: 'Web search is not configured yet — an admin needs to add a TAVILY_API_KEY.' }
  }
  const query = String(args?.query ?? '').trim().slice(0, 400)
  if (!query) return { error: 'No search query was provided.' }
  const maxResults = Math.min(Math.max(Number(args?.max_results) || 5, 1), 8)

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: maxResults,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { error: `Web search failed (${res.status}).` }
    const data = await res.json()
    return {
      answer: data?.answer ?? null,
      results: (data?.results ?? []).slice(0, maxResults).map((r: any) => ({
        title: r?.title,
        url: r?.url,
        snippet: typeof r?.content === 'string' ? r.content.slice(0, 500) : undefined,
      })),
    }
  } catch (err) {
    console.error('web_search failed:', err)
    return { error: 'Web search timed out or is unavailable.' }
  }
}

// Block obvious SSRF targets (loopback, private ranges, link-local, cloud metadata).
// Not bulletproof against DNS rebinding, but adequate for an internal assistant.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes('metadata')) return true
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  if (h === '::1' || h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

async function fetchUrl(args: any) {
  const raw = String(args?.url ?? '').trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { error: 'That is not a valid URL.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http(s) URLs can be fetched.' }
  if (isBlockedHost(url.hostname)) return { error: 'That host is not allowed.' }

  try {
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      headers: { 'User-Agent': 'ProjectManagerBot/1.0', Accept: 'text/html,text/plain,*/*' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return { error: `Could not fetch the page (${res.status}).` }
    const ctype = res.headers.get('content-type') ?? ''
    if (!/text\/html|text\/plain|application\/(xhtml|json)/.test(ctype)) {
      return { error: `Unsupported content type (${ctype || 'unknown'}).` }
    }
    const html = (await res.text()).slice(0, 400_000)
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 6000)
    return { url: url.toString(), text: text || '(no readable text found)' }
  } catch (err) {
    console.error('fetch_url failed:', err)
    return { error: 'Fetching that page timed out or failed.' }
  }
}

export async function executeTool(name: string, args: any, ctx: ToolContext): Promise<any> {
  try {
    switch (name) {
      case 'get_tasks':
        return await getTasks(ctx, args)
      case 'get_boards':
        return await getBoards(ctx)
      case 'get_personal_tasks':
        return await getPersonalTasks(ctx, args)
      case 'get_marketing_calendar':
        return await getMarketingCalendar(ctx, args)
      case 'web_search':
        return await webSearch(args)
      case 'fetch_url':
        return await fetchUrl(args)
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (err) {
    console.error(`AI chat tool "${name}" failed:`, err)
    return { error: 'Tool execution failed' }
  }
}
