'use client'

// LIST - "optimize for scanability. Support hierarchy, inline editing, selected visible fields,
// bulk select."
//
// Scanability is why the title carries the row and every other field is secondary metadata on
// one line: the eye runs down a single left edge instead of hunting across columns. The table
// layout is the one that puts fields in columns, and the two exist side by side because those
// are genuinely different jobs - find one thing fast, versus compare many things.

import { ChevronRight } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { densityListClass, type Density } from '@/components/shell/density'
import { FieldCell } from './task-fields'
import type { EvalContext, ViewConfig, ViewGroup } from '@/lib/view-config'
import { cn } from '@/lib/utils'

interface ListLayoutProps {
  groups: ViewGroup[]
  config: ViewConfig
  ctx: EvalContext
  density: Density
  /** Subtasks by parent id, for `hierarchy: 'nested'`. */
  childrenByParent: Map<string, any[]>
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onOpenTask: (taskId: string) => void
  collapsedGroups: string[]
  onToggleGroup: (key: string) => void
}

export function ListLayout({
  groups, config, ctx, density, childrenByParent, selectable, selectedIds,
  onToggleSelect, onOpenTask, collapsedGroups, onToggleGroup,
}: ListLayoutProps) {
  const secondaryFields = config.fields.filter((f) => f !== 'title')

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const collapsed = collapsedGroups.includes(group.key)
        return (
          <section key={group.key}>
            {group.key !== '__all__' && (
              <button
                type="button"
                className="hover:bg-muted/50 mb-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-left"
                onClick={() => onToggleGroup(group.key)}
                aria-expanded={!collapsed}
              >
                <ChevronRight
                  className={cn('h-4 w-4 shrink-0 transition-transform', !collapsed && 'rotate-90')}
                  aria-hidden
                />
                <span className="text-sm font-semibold">{group.label}</span>
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{group.tasks.length}</Badge>
              </button>
            )}

            {!collapsed && (
              <ul className={cn('rounded-md border', densityListClass(density), 'p-1')}>
                {group.tasks.length === 0 && (
                  <li className="text-muted-foreground px-3 py-4 text-sm">Nothing here.</li>
                )}
                {group.tasks.map((task: any) => (
                  <ListRow
                    key={task.id}
                    task={task}
                    depth={0}
                    config={config}
                    ctx={ctx}
                    density={density}
                    secondaryFields={secondaryFields}
                    childrenByParent={childrenByParent}
                    selectable={selectable}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function ListRow({
  task, depth, config, ctx, density, secondaryFields, childrenByParent,
  selectable, selectedIds, onToggleSelect, onOpenTask,
}: {
  task: any
  depth: number
  config: ViewConfig
  ctx: EvalContext
  density: Density
  secondaryFields: string[]
  childrenByParent: Map<string, any[]>
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onOpenTask: (taskId: string) => void
}) {
  const selected = selectedIds.includes(task.id)
  // Only `nested` descends. `parents_only` already dropped subtasks upstream, and `flat`
  // rendered them as their own top-level rows - descending in either would double them.
  const children = config.hierarchy === 'nested' ? (childrenByParent.get(task.id) ?? []) : []

  return (
    <>
      <li
        className={cn(
          'group hover:bg-muted/50 flex items-center gap-2 rounded px-2',
          density === 'compact' ? 'py-1' : density === 'expanded' ? 'py-2.5' : 'py-1.5',
          selected && 'bg-primary/10',
        )}
        style={depth ? { paddingLeft: `${depth * 1.25 + 0.5}rem` } : undefined}
      >
        {selectable && (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 cursor-pointer"
            checked={selected}
            aria-label={`Select ${task.title}`}
            onChange={() => undefined}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id, e) }}
          />
        )}

        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left"
          onClick={() => onOpenTask(task.id)}
        >
          <FieldCell task={task} field="title" ctx={ctx} />
        </button>

        <span className="flex shrink-0 items-center gap-3">
          {secondaryFields.map((field) => (
            <span key={field} className="hidden sm:inline-flex">
              <FieldCell task={task} field={field} ctx={ctx} />
            </span>
          ))}
        </span>
      </li>

      {children.map((child: any) => (
        <ListRow
          key={child.id}
          task={child}
          depth={depth + 1}
          config={config}
          ctx={ctx}
          density={density}
          secondaryFields={secondaryFields}
          childrenByParent={childrenByParent}
          selectable={selectable}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onOpenTask={onOpenTask}
        />
      ))}
    </>
  )
}
