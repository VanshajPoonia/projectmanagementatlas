'use client'

// KANBAN - "configurable grouping, collapse columns, quick add, blocked indicator, parent
// context, visible field settings, density, keyboard-accessible move alternative, optimistic
// drag with rollback."
//
// The one real difference from the existing board: THE COLUMNS ARE NOT THE BOARD'S COLUMNS.
// They are whatever `config.group` says - status, assignee, priority, tag, board, due bucket.
// That is what "configurable grouping" means, and it is why this cannot simply reuse
// board-view.tsx, whose columns are rows in the `columns` table.
//
// ⚠️ WHICH MEANS A DRAG IS NOT ALWAYS A MOVE. Dropping a card into another status column has
// one obvious meaning; dropping it into another TAG column does not - the task may hold three
// tags, so "moved to Urgent" could mean add Urgent, or replace them all, and guessing would
// silently destroy data. So grouping fields declare whether a drop is meaningful, and where it
// is not, the columns are still shown and still collapse, drag is switched OFF, and the header
// SAYS WHY rather than letting someone drag a card that springs back with no explanation
// (ATLAS_01 10.2).
//
// The move menu is the keyboard-accessible alternative Prompt E asks for and it is not a
// second-class path: it calls exactly the same `onMoveTask` the drag does, so the two cannot
// drift apart.

import { useState } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { ChevronRight, CornerDownRight, MoreVertical, Plus, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { densityCardClass, type Density } from '@/components/shell/density'
import { FieldCell } from './task-fields'
import type { EvalContext, GroupField, ViewConfig, ViewGroup } from '@/lib/view-config'
import { cn } from '@/lib/utils'

/**
 * Group fields where dropping a card has exactly one meaning. Everything else is display-only.
 * `tag` is excluded deliberately - a task can hold several, so a drop is ambiguous.
 * `board` is excluded because moving a task between boards has to re-target its column too,
 * which is what move_task_to_board (migration 102) exists for; a silent drag is the wrong
 * front door for it.
 */
const MOVABLE_GROUPS: readonly GroupField[] = ['status', 'assignee', 'priority']

const NOT_MOVABLE_REASON: Partial<Record<GroupField, string>> = {
  tag: 'Cards cannot be dragged when grouped by tag - a task can carry several, so a drop would be ambiguous. Edit tags on the task itself.',
  board: 'Moving a task to another board also has to re-target its column. Use "Move to another board" on the task.',
  status_category: 'A category is what a status means, not a value you can set. Group by status to move work.',
  type: 'Changing a work type has rules about parents and children. Change it on the task.',
  due_bucket: 'These buckets are calculated from the due date. Set a date on the task instead.',
  created_by: 'Who created a task is a fact about the past, not something to change.',
}

export function isGroupMovable(group: GroupField | null): boolean {
  return group !== null && MOVABLE_GROUPS.includes(group)
}

interface KanbanLayoutProps {
  groups: ViewGroup[]
  config: ViewConfig
  ctx: EvalContext
  density: Density
  /** Task ids something else is blocking (task_relations, migration 115). */
  blockedIds?: Set<string>
  /** Parent title by task id, so a subtask carries its context. */
  parentTitles?: Map<string, string>
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onOpenTask: (taskId: string) => void
  /** Returns false when the write did not land, so the optimistic move can be rolled back. */
  onMoveTask?: (taskId: string, group: GroupField, targetKey: string) => Promise<boolean>
  onQuickAdd?: (group: GroupField | null, groupKey: string) => void
  canCreate?: boolean
  createBlockedReason?: string | null
}

export function KanbanLayout({
  groups, config, ctx, density, blockedIds, parentTitles, selectable, selectedIds,
  onToggleSelect, onOpenTask, onMoveTask, onQuickAdd, canCreate = false, createBlockedReason,
}: KanbanLayoutProps) {
  const [collapsed, setCollapsed] = useState<string[]>([])
  // Optimistic overrides: taskId -> the group key it was dragged into. Cleared on rollback and
  // when the host sends fresh data.
  const [pending, setPending] = useState<Record<string, string>>({})

  const group = config.group
  const movable = isGroupMovable(group) && Boolean(onMoveTask)
  const blockedReason = group ? NOT_MOVABLE_REASON[group] : undefined

  const toggle = (key: string) =>
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  // Apply the optimistic overrides on top of whatever the engine produced, so a dragged card
  // stays where it was dropped until the write comes back.
  const rendered: ViewGroup[] = groups.map((g) => ({
    ...g,
    tasks: [
      ...g.tasks.filter((t: any) => (pending[t.id] ?? g.key) === g.key),
      ...groups.flatMap((other) =>
        other.key === g.key ? [] : other.tasks.filter((t: any) => pending[t.id] === g.key),
      ),
    ],
  }))

  const move = async (taskId: string, targetKey: string) => {
    if (!group || !onMoveTask) return
    setPending((prev) => ({ ...prev, [taskId]: targetKey }))
    const ok = await onMoveTask(taskId, group, targetKey)
    // Rollback on refusal. An RLS refusal returns zero rows and no error, so `false` is the
    // only signal there is - the card must go back rather than sit in a column the database
    // never agreed to.
    setPending((prev) => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })
    return ok
  }

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    if (result.destination.droppableId === result.source.droppableId) return
    void move(result.draggableId, result.destination.droppableId)
  }

  const board = (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {rendered.map((g) => {
        const isCollapsed = collapsed.includes(g.key)
        return (
          <section
            key={g.key}
            className={cn(
              'bg-muted/30 flex shrink-0 flex-col rounded-lg border',
              isCollapsed ? 'w-12' : 'w-[300px]',
            )}
          >
            <header className={cn('flex items-center gap-1.5 border-b p-2', isCollapsed && 'flex-col')}>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `Expand ${g.label}` : `Collapse ${g.label}`}
                className="hover:bg-muted shrink-0 rounded p-0.5"
              >
                <ChevronRight className={cn('h-4 w-4 transition-transform', !isCollapsed && 'rotate-90')} aria-hidden />
              </button>
              {isCollapsed ? (
                <span className="text-muted-foreground [writing-mode:vertical-rl] py-2 text-xs font-medium">
                  {g.label} ({g.tasks.length})
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.label}</span>
                  <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[11px]">{g.tasks.length}</Badge>
                  {canCreate && onQuickAdd && (
                    <Button
                      type="button" variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0"
                      onClick={() => onQuickAdd(group, g.key)}
                      aria-label={`Add a task in ${g.label}`}
                      title={createBlockedReason ?? `Add a task in ${g.label}`}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </>
              )}
            </header>

            {!isCollapsed && (
              <Droppable droppableId={g.key} isDropDisabled={!movable}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={cn(
                      'min-h-[80px] flex-1 space-y-2 overflow-y-auto p-2',
                      snapshot.isDraggingOver && 'bg-primary/5',
                    )}
                  >
                    {g.tasks.map((task: any, index: number) => (
                      <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={!movable}>
                        {(dragProvided, dragSnapshot) => (
                          <div
                            ref={dragProvided.innerRef}
                            {...dragProvided.draggableProps}
                            {...dragProvided.dragHandleProps}
                            className={cn(dragSnapshot.isDragging && 'opacity-80')}
                          >
                            <KanbanCard
                              task={task}
                              config={config}
                              ctx={ctx}
                              density={density}
                              blocked={blockedIds?.has(task.id) ?? false}
                              parentTitle={parentTitles?.get(task.id)}
                              selectable={selectable}
                              selected={selectedIds.includes(task.id)}
                              onToggleSelect={onToggleSelect}
                              onOpenTask={onOpenTask}
                              moveTargets={movable ? rendered.filter((o) => o.key !== g.key) : []}
                              onMove={(targetKey) => void move(task.id, targetKey)}
                            />
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                    {g.tasks.length === 0 && (
                      <p className="text-muted-foreground px-1 py-3 text-xs">Nothing here.</p>
                    )}
                  </div>
                )}
              </Droppable>
            )}
          </section>
        )
      })}
    </div>
  )

  return (
    <div className="space-y-2">
      {!movable && group && blockedReason && (
        <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
          {blockedReason}
        </p>
      )}
      {!group && (
        <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
          Choose something to group by and this becomes a board. Without a grouping there is only
          one column.
        </p>
      )}
      <DragDropContext onDragEnd={onDragEnd}>{board}</DragDropContext>
    </div>
  )
}

function KanbanCard({
  task, config, ctx, density, blocked, parentTitle, selectable, selected,
  onToggleSelect, onOpenTask, moveTargets, onMove,
}: {
  task: any
  config: ViewConfig
  ctx: EvalContext
  density: Density
  blocked: boolean
  parentTitle?: string
  selectable: boolean
  selected: boolean
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onOpenTask: (taskId: string) => void
  moveTargets: ViewGroup[]
  onMove: (targetKey: string) => void
}) {
  const secondary = config.fields.filter((f) => f !== 'title')

  return (
    <div
      className={cn(
        'bg-card rounded-md border shadow-sm transition-colors',
        densityCardClass(density),
        selected && 'ring-primary ring-2',
      )}
    >
      {parentTitle && (
        <p className="text-muted-foreground mb-1 flex items-center gap-1 truncate text-[11px]">
          <CornerDownRight className="h-3 w-3 shrink-0" aria-hidden />
          {parentTitle}
        </p>
      )}

      <div className="flex items-start gap-1.5">
        {selectable && (
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
            checked={selected}
            aria-label={`Select ${task.title}`}
            onChange={() => undefined}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id, e) }}
          />
        )}

        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenTask(task.id)}>
          <span className="line-clamp-2 text-sm font-medium">{task.title || 'Untitled'}</span>
        </button>

        {moveTargets.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button" variant="ghost" size="sm" className="h-6 w-6 shrink-0 p-0"
                aria-label={`Move ${task.title} to another column`}
              >
                <MoreVertical className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
              {moveTargets.map((target) => (
                <DropdownMenuItem key={target.key} onSelect={() => onMove(target.key)}>
                  {target.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {blocked && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
          <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
          Blocked by other work
        </p>
      )}

      {density !== 'compact' && secondary.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {secondary.map((field) => (
            <FieldCell key={field} task={task} field={field} ctx={ctx} />
          ))}
        </div>
      )}
    </div>
  )
}
