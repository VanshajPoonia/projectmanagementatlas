'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Calendar, CornerDownRight, Kanban, Sparkles } from 'lucide-react'
import { getWorkNext } from '@/lib/work-next'
import { cleanTaskDescription } from '@/lib/display-text'
import { cn } from '@/lib/utils'

interface WorkNextProps {
  /** Tasks already narrowed to the current user; ranking handles the rest. */
  tasks: any[]
  /** Board links differ between the user (/dashboard) and admin (/admin) shells. */
  basePath?: string
  limit?: number
}

export default function WorkNext({ tasks, basePath = '/dashboard', limit = 5 }: WorkNextProps) {
  const ranked = useMemo(() => getWorkNext(tasks, limit), [tasks, limit])

  if (ranked.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-8 text-center">
        <Sparkles className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">Nothing needs your attention</p>
        <p className="text-xs text-muted-foreground">Every task assigned to you is done.</p>
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {ranked.map(({ task, reasons, isOverdue }, index) => {
        const boardId = task.column?.board_id
        const description = cleanTaskDescription(task.description)

        return (
          <li key={task.id}>
            <Link
              href={boardId ? `${basePath}/board/${boardId}` : '#'}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 transition-all hover:border-primary/30 hover:bg-accent hover:shadow-md',
                // Only the top pick gets emphasis — that is the whole point of the panel.
                index === 0 && 'border-primary/40 bg-primary/5',
                isOverdue && 'border-red-300 bg-red-50/40'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  index === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
                )}
                aria-hidden
              >
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                {/* Subtask titles are often only meaningful next to their parent
                    ("Send draft" tells you nothing on its own). */}
                {task.parent?.title && (
                  <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                    <CornerDownRight className="h-3 w-3 flex-shrink-0" />
                    {task.parent.title}
                  </p>
                )}
                <h4 className="break-words text-sm font-medium leading-tight [overflow-wrap:anywhere]">
                  {task.title}
                </h4>

                {description && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{description}</p>
                )}

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {reasons.map((reason) => (
                    <Badge
                      key={reason}
                      variant="outline"
                      className={cn(
                        'px-1.5 py-0 text-[11px] font-normal',
                        isOverdue && reason.includes('overdue') && 'border-red-300 text-red-600'
                      )}
                    >
                      {reason}
                    </Badge>
                  ))}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  {task.column?.board?.title && (
                    <span className="flex items-center gap-1">
                      <Kanban className="h-3 w-3" />
                      {task.column.board.title}
                    </span>
                  )}
                  {task.due_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(task.due_date).toLocaleDateString('en-US')}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
