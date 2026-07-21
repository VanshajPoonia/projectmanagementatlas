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

import { getAssigneeIds, getAssigneeNames } from './assignees'
import { getNormalizedTaskStatus, getTaskStatusLabel } from './task-status'

export interface ToolContext {
  supabase: any
  userId: string
}

export const AI_CHAT_TOOLS = [
  {
    name: 'get_tasks',
    description:
      "Lists tasks from the team's Kanban boards — title, status, priority, due date, board, assignees. Use for questions about tasks, what's due, overdue work, or a specific board's contents.",
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
      'id, title, status, priority, due_date, created_by, assigned_to, task_assignees(user_id), column:columns(board_id, title)'
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
      if (args?.scope !== 'all') {
        const mine = getAssigneeIds(t).includes(userId) || t.created_by === userId
        if (!mine) return false
      }
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
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      status: getTaskStatusLabel(t),
      priority: t.priority,
      due_date: t.due_date,
      board: boardTitleById.get(t.column.board_id),
      assignees: getAssigneeNames(t, profileList),
    }))

  return { count: tasks.length, tasks }
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
      default:
        return { error: `Unknown tool: ${name}` }
    }
  } catch (err) {
    console.error(`AI chat tool "${name}" failed:`, err)
    return { error: 'Tool execution failed' }
  }
}
