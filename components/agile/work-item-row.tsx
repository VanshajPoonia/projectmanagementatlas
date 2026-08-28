'use client'

// One canonical work item, drawn for the agile surfaces.
//
// ⚠️ This is a ROW, not a copy. Prompt G's strongest architectural requirement is Taiga's:
// "the same underlying item can be represented in Scrum and Kanban - never copy the task to
// make it appear in a second methodology." So this renders `tasks` rows straight, and the
// title links into the board's own task modal rather than opening a second editor that could
// drift from it.

import { useState } from 'react'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { formatEstimate, type EstimateUnit } from '@/lib/agile'
import { getTaskStatusLabel, type StatusCatalog } from '@/lib/task-status'
import { densityCardClass, type Density } from '@/components/shell/density'
import { calendarDateLabel, taskDueDate } from '@/lib/calendar-grid'

export interface WorkItemRowProps {
  task: any
  unit: EstimateUnit
  statuses: StatusCatalog
  density: Density
  selected?: boolean
  onToggleSelect?: (id: string, next: boolean) => void
  onOpen?: (id: string) => void
  /** Menu actions. Each is omitted rather than disabled when it does not apply. */
  actions?: { label: string; onSelect: () => void; destructive?: boolean }[]
  /** Inline estimate editing. Omitted for a viewer who cannot manage the task. */
  onEstimate?: (id: string, value: number | null) => void
  canEstimate?: boolean
  dragHandleProps?: any
  /** Rendered at the end of the row, e.g. a one-click add/remove. */
  trailing?: React.ReactNode
}

export function WorkItemRow({
  task, unit, statuses, density, selected, onToggleSelect, onOpen, actions,
  onEstimate, canEstimate = false, dragHandleProps, trailing,
}: WorkItemRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const due = taskDueDate(task)
  const estimate = task.estimate_value === null || task.estimate_value === undefined
    ? null
    : Number(task.estimate_value)

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed === '') { onEstimate?.(task.id, null); return }
    const n = Number(trimmed)
    if (!Number.isFinite(n) || n < 0) return
    onEstimate?.(task.id, n)
  }

  return (
    <div className={`bg-card flex items-start rounded-md border ${densityCardClass(density)}`}>
      {dragHandleProps && (
        <span {...dragHandleProps} className="text-muted-foreground mt-0.5 cursor-grab" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
      )}
      {onToggleSelect && (
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={Boolean(selected)}
          onChange={(e) => onToggleSelect(task.id, e.target.checked)}
          aria-label={`Select ${task.title}`}
        />
      )}

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen?.(task.id)}
          className="hover:underline focus-visible:ring-ring block w-full truncate text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
        >
          {task.title}
        </button>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline" className="text-[10px]">{getTaskStatusLabel(task, statuses)}</Badge>
          {task.parent_task_id && <span className="truncate">child item</span>}
          {due && <span>Due {calendarDateLabel(due)}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {editing ? (
          <Input
            autoFocus
            type="number"
            min="0"
            step="0.5"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            }}
            // ⚠️ size={1} - an <input>'s intrinsic ~20-character width otherwise beats the
            // class-set width and visibly widens the row as you type. Same trap as the
            // marketing grid's in-place channel rename.
            size={1}
            className="h-7 w-16 text-xs"
            aria-label={`Estimate for ${task.title}`}
          />
        ) : canEstimate && onEstimate ? (
          <button
            type="button"
            onClick={() => { setDraft(estimate === null ? '' : String(estimate)); setEditing(true) }}
            className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${estimate === null ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'} hover:bg-muted`}
            aria-label={`Set estimate for ${task.title}`}
          >
            {estimate === null ? 'No estimate' : formatEstimate(estimate, unit)}
          </button>
        ) : (
          <span className="text-muted-foreground px-1.5 text-xs tabular-nums">
            {formatEstimate(estimate, unit)}
          </span>
        )}

        {trailing}

        {actions && actions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${task.title}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="max-w-56 truncate">{task.title}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  onSelect={action.onSelect}
                  className={action.destructive ? 'text-destructive' : undefined}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
