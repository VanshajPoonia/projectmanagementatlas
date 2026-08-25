'use client'

// One renderer for "show me field X of task Y", shared by every layout.
//
// The whole point of Prompt E's `visibleFields` is that a field means the same thing in a list,
// a table and a card. If each layout formatted a due date its own way, "visible fields" would
// be three settings wearing one name. So layouts choose WHICH fields and WHERE; this file
// decides what each one looks like.

import { Badge } from '@/components/ui/badge'
import { getAssigneeIds } from '@/lib/assignees'
import { cleanTaskDescription } from '@/lib/display-text'
import { businessDate } from '@/lib/crm'
import {
  STATUS_CATEGORY_LABELS,
  getTaskStatusCategory,
  getTaskStatusLabel,
} from '@/lib/task-status'
import { parseCustomFilterField, type EvalContext } from '@/lib/view-config'
import { cn } from '@/lib/utils'

const PRIORITY_LABELS: Record<string, string> = {
  '1': 'Highest', '2': 'High', '3': 'Medium', '4': 'Low', '5': 'Lowest',
}
const PRIORITY_TONE: Record<string, string> = {
  '1': 'bg-red-500/15 text-red-700 dark:text-red-300',
  '2': 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  '3': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  '4': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  '5': 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
}

export const FIELD_WIDTHS: Record<string, number> = {
  title: 320, description: 280, assignee: 170, created_by: 170, priority: 110,
  status: 140, status_category: 130, board: 160, tag: 180, type: 120,
  due_date: 130, created_at: 130,
}

export function defaultFieldWidth(field: string): number {
  return FIELD_WIDTHS[field] ?? 150
}

/**
 * A due date renders relative to the business calendar, never to the runtime's clock. A DATE
 * column arrives as YYYY-MM-DD and must not be parsed into an instant - that is the five-hour
 * window that made the CRM disagree with itself between server and browser.
 */
export function dueDateTone(due: unknown, now: Date): 'overdue' | 'today' | 'future' | 'none' {
  if (!due) return 'none'
  const raw = String(due)
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : businessDate(new Date(raw))
  const today = businessDate(now)
  if (value < today) return 'overdue'
  if (value === today) return 'today'
  return 'future'
}

function formatCalendarDate(value: unknown, now: Date): string {
  if (!value) return '—'
  const raw = String(value)
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : businessDate(new Date(raw))
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return '—'
  // Built from the parts, not from Date.parse on the string, for the reason above.
  const label = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: y === now.getUTCFullYear() ? undefined : 'numeric', timeZone: 'UTC',
  })
  return label
}

interface FieldCellProps {
  task: any
  field: string
  ctx: EvalContext
  className?: string
}

export function FieldCell({ task, field, ctx, className }: FieldCellProps) {
  const custom = parseCustomFilterField(field)
  if (custom) {
    const value = ctx.customValues?.[task?.id]?.[custom]
    return (
      <span className={cn('truncate text-sm', className)}>
        {value == null || value === '' ? <Muted /> : String(value)}
      </span>
    )
  }

  switch (field) {
    case 'title':
      return <span className={cn('truncate text-sm font-medium', className)}>{task?.title || 'Untitled'}</span>

    case 'description': {
      const text = cleanTaskDescription(task?.description)
      return <span className={cn('text-muted-foreground truncate text-sm', className)}>{text || <Muted />}</span>
    }

    case 'assignee': {
      const ids = getAssigneeIds(task)
      if (ids.length === 0) return <Muted className={className}>Unassigned</Muted>
      const names = ids
        .map((id) => (ctx.users ?? []).find((u: any) => u?.id === id))
        .map((u: any) => u?.full_name || u?.email || 'Unknown')
      return (
        <span className={cn('truncate text-sm', className)} title={names.join(', ')}>
          {names[0]}
          {names.length > 1 && <span className="text-muted-foreground"> +{names.length - 1}</span>}
        </span>
      )
    }

    case 'created_by': {
      const user = (ctx.users ?? []).find((u: any) => u?.id === task?.created_by)
      return <span className={cn('truncate text-sm', className)}>{user?.full_name || user?.email || <Muted />}</span>
    }

    case 'priority': {
      const key = task?.priority == null ? null : String(task.priority)
      if (!key) return <Muted className={className} />
      return (
        <Badge variant="secondary" className={cn('font-normal', PRIORITY_TONE[key], className)}>
          {PRIORITY_LABELS[key] ?? key}
        </Badge>
      )
    }

    case 'status':
      return (
        <Badge variant="outline" className={cn('font-normal', className)}>
          {getTaskStatusLabel(task, ctx.statuses)}
        </Badge>
      )

    case 'status_category': {
      const category = getTaskStatusCategory(task, ctx.statuses)
      return <span className={cn('text-sm', className)}>{category ? STATUS_CATEGORY_LABELS[category] : <Muted />}</span>
    }

    case 'board': {
      const board = (ctx.boards ?? []).find((b: any) => b?.id === task?.board_id)
      return <span className={cn('truncate text-sm', className)}>{board?.title ?? task?.board_title ?? <Muted />}</span>
    }

    case 'tag': {
      const tags = Array.isArray(task?.task_tags) ? task.task_tags : []
      if (tags.length === 0) return <Muted className={className} />
      return (
        <span className={cn('flex flex-wrap gap-1', className)}>
          {tags.slice(0, 3).map((tt: any, i: number) => (
            <Badge key={tt?.tag?.id ?? i} variant="secondary" className="font-normal">
              {tt?.tag?.name ?? '—'}
            </Badge>
          ))}
          {tags.length > 3 && <span className="text-muted-foreground text-xs">+{tags.length - 3}</span>}
        </span>
      )
    }

    case 'type':
      return <span className={cn('text-muted-foreground text-sm capitalize', className)}>{task?.type_key ?? <Muted />}</span>

    case 'due_date': {
      const tone = dueDateTone(task?.due_date, ctx.now)
      if (tone === 'none') return <Muted className={className} />
      return (
        <span
          className={cn(
            'text-sm',
            tone === 'overdue' && 'text-red-600 dark:text-red-400 font-medium',
            tone === 'today' && 'text-amber-600 dark:text-amber-400 font-medium',
            className,
          )}
        >
          {formatCalendarDate(task?.due_date, ctx.now)}
        </span>
      )
    }

    case 'created_at':
      return <span className={cn('text-muted-foreground text-sm', className)}>{formatCalendarDate(task?.created_at, ctx.now)}</span>

    default:
      return <Muted className={className} />
  }
}

function Muted({ children = '—', className }: { children?: React.ReactNode; className?: string }) {
  return <span className={cn('text-muted-foreground text-sm', className)}>{children}</span>
}
