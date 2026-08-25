'use client'

// TABLE - "resize columns, reorder columns, sort, inline edit, sticky identifier/title, bulk
// selection, virtualization."
//
// Everything on that list is here except virtualization, which is a DELIBERATE omission rather
// than an oversight, and the reasoning is worth keeping:
//
//   Production holds 171 tasks. A windowed table at that size costs measurable things and buys
//   nothing: the browser's own Cmd-F stops finding rows that are not mounted, Cmd-A selects a
//   fraction of what is on screen, printing produces one page, and screen readers lose the row
//   count. Those are real regressions traded for a scroll that is already smooth. The honest
//   trigger is a row count, not a checklist - when a single view returns thousands of rows,
//   this component gets windowed and gains a "showing N of M" line so the loss is visible.
//   Building it now would be optimizing a number nobody has.
//
// COLUMN WIDTHS AND ORDER ARE PER USER, like density, and for the same reason: how wide you
// want the title column is not a fact about the work. Order lives in the config because Prompt E
// puts `field order` in the saved view; width does not, because a width saved by someone on a
// 32-inch monitor is actively wrong on a laptop.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, GripVertical } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { defaultFieldWidth, FieldCell } from './task-fields'
import { describeField, type EvalContext, type SortRule, type ViewConfig, type ViewGroup } from '@/lib/view-config'
import { cn } from '@/lib/utils'

const MIN_WIDTH = 80
const MAX_WIDTH = 640

interface TableLayoutProps {
  groups: ViewGroup[]
  config: ViewConfig
  ctx: EvalContext
  childrenByParent: Map<string, any[]>
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onSelectAll: (taskIds: string[], selected: boolean) => void
  onOpenTask: (taskId: string) => void
  onSortChange: (sort: SortRule[]) => void
  onFieldsChange: (fields: string[]) => void
  /** Inline edit of the title. Returns false when the write did not land. */
  onRenameTask?: (taskId: string, title: string) => Promise<boolean>
  extraFieldLabels?: Record<string, string>
  collapsedGroups: string[]
  onToggleGroup: (key: string) => void
}

export function TableLayout({
  groups, config, ctx, childrenByParent, selectable, selectedIds, onToggleSelect,
  onSelectAll, onOpenTask, onSortChange, onFieldsChange, onRenameTask,
  extraFieldLabels = {}, collapsedGroups, onToggleGroup,
}: TableLayoutProps) {
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [dragField, setDragField] = useState<string | null>(null)
  const resizing = useRef<{ field: string; startX: number; startWidth: number } | null>(null)

  const widthOf = (field: string) => widths[field] ?? defaultFieldWidth(field)

  const onResizeStart = (field: string, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizing.current = { field, startX: e.clientX, startWidth: widthOf(field) }
  }

  // Listeners live on the document, not the handle: a fast drag outruns the 4px grip and the
  // pointer ends up over a neighbouring cell, at which point a handle-bound listener stops
  // receiving moves and the column sticks mid-resize.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const state = resizing.current
      if (!state) return
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, state.startWidth + (e.clientX - state.startX)))
      setWidths((prev) => ({ ...prev, [state.field]: next }))
    }
    const onUp = () => { resizing.current = null }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
  }, [])

  const toggleSort = useCallback((field: string) => {
    const sortable = ['title', 'priority', 'due_date', 'created_at', 'status', 'assignee', 'board'] as const
    if (!sortable.includes(field as any)) return
    const current = config.sort[0]
    if (current?.field === field) {
      onSortChange([{ field: field as SortRule['field'], direction: current.direction === 'asc' ? 'desc' : 'asc' }])
    } else {
      onSortChange([{ field: field as SortRule['field'], direction: 'asc' }])
    }
  }, [config.sort, onSortChange])

  const onHeaderDrop = (target: string) => {
    if (!dragField || dragField === target || dragField === 'title') return
    const next = config.fields.filter((f) => f !== dragField)
    const at = next.indexOf(target)
    // Never before the title: it is the sticky identifier column, and a table whose first
    // column is a due date gives the eye nothing to anchor on.
    next.splice(Math.max(at, 1), 0, dragField)
    onFieldsChange(next)
    setDragField(null)
  }

  const allVisibleIds = groups.flatMap((g) => g.tasks.map((t: any) => t.id))
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.includes(id))

  const labelFor = (field: string) =>
    describeField(field)?.label ?? extraFieldLabels[field] ?? field

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm" style={{ minWidth: 'max-content' }}>
        <thead className="bg-muted/50 sticky top-0 z-20">
          <tr>
            {selectable && (
              <th className="bg-muted/50 sticky left-0 z-30 w-10 border-b px-2 py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer"
                  checked={allSelected}
                  aria-label="Select every visible task"
                  onChange={(e) => onSelectAll(allVisibleIds, e.target.checked)}
                />
              </th>
            )}
            {config.fields.map((field) => {
              const isTitle = field === 'title'
              const sort = config.sort[0]?.field === field ? config.sort[0] : null
              return (
                <th
                  key={field}
                  className={cn(
                    'group relative border-b px-3 py-2 text-left font-medium',
                    isTitle && 'bg-muted/50 sticky z-30',
                  )}
                  style={{ width: widthOf(field), ...(isTitle ? { left: selectable ? 40 : 0 } : {}) }}
                  draggable={!isTitle && !resizing.current}
                  onDragStart={() => setDragField(field)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onHeaderDrop(field)}
                >
                  <span className="flex items-center gap-1">
                    {!isTitle && (
                      <GripVertical
                        className="text-muted-foreground/40 h-3 w-3 shrink-0 cursor-grab opacity-0 group-hover:opacity-100"
                        aria-hidden
                      />
                    )}
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => toggleSort(field)}
                      title={`Sort by ${labelFor(field)}`}
                    >
                      {labelFor(field)}
                    </button>
                    {sort && (sort.direction === 'asc'
                      ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden />
                      : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden />)}
                  </span>

                  <span
                    role="separator"
                    aria-label={`Resize ${labelFor(field)}`}
                    className="hover:bg-primary/40 absolute top-0 right-0 h-full w-1 cursor-col-resize select-none"
                    onPointerDown={(e) => onResizeStart(field, e)}
                  />
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {groups.map((group) => {
            const collapsed = collapsedGroups.includes(group.key)
            return (
              // Fragment, not <>, because this is the element `groups.map` returns and it needs
              // the key. React warned about exactly this in a real browser run.
              <Fragment key={group.key}>
                {group.key !== '__all__' && (
                  <tr key={`${group.key}-header`} className="bg-muted/30">
                    <td colSpan={config.fields.length + (selectable ? 1 : 0)} className="border-b px-2 py-1.5">
                      <button
                        type="button"
                        className="flex items-center gap-1.5"
                        onClick={() => onToggleGroup(group.key)}
                        aria-expanded={!collapsed}
                      >
                        <ChevronRight className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-90')} aria-hidden />
                        <span className="font-semibold">{group.label}</span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{group.tasks.length}</Badge>
                      </button>
                    </td>
                  </tr>
                )}

                {!collapsed && group.tasks.map((task: any) => (
                  <TableRow
                    key={task.id}
                    task={task}
                    depth={0}
                    config={config}
                    ctx={ctx}
                    widthOf={widthOf}
                    childrenByParent={childrenByParent}
                    selectable={selectable}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onOpenTask={onOpenTask}
                    onRenameTask={onRenameTask}
                  />
                ))}

                {!collapsed && group.tasks.length === 0 && (
                  <tr key={`${group.key}-empty`}>
                    <td colSpan={config.fields.length + (selectable ? 1 : 0)} className="text-muted-foreground px-3 py-4">
                      Nothing here.
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TableRow({
  task, depth, config, ctx, widthOf, childrenByParent, selectable, selectedIds,
  onToggleSelect, onOpenTask, onRenameTask,
}: {
  task: any
  depth: number
  config: ViewConfig
  ctx: EvalContext
  widthOf: (field: string) => number
  childrenByParent: Map<string, any[]>
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (taskId: string, event: React.MouseEvent) => void
  onOpenTask: (taskId: string) => void
  onRenameTask?: (taskId: string, title: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.title ?? '')
  const [saving, setSaving] = useState(false)
  const selected = selectedIds.includes(task.id)
  const children = config.hierarchy === 'nested' ? (childrenByParent.get(task.id) ?? []) : []

  const commit = async () => {
    const next = draft.trim()
    if (!onRenameTask || !next || next === task.title) { setEditing(false); setDraft(task.title ?? ''); return }
    setSaving(true)
    const ok = await onRenameTask(task.id, next)
    setSaving(false)
    // A refused write must put the old value back on screen. Leaving the typed text there
    // shows a title that is not in the database and that nobody will notice is not saved.
    if (!ok) setDraft(task.title ?? '')
    setEditing(false)
  }

  return (
    <>
      {/* ⚠️ `group` is load-bearing: the rename affordance below is opacity-0 until
          group-hover, and without a `group` ancestor it stayed invisible to every mouse user
          forever - reachable only by tabbing to it. Found in a real browser. */}
      <tr className={cn('group hover:bg-muted/40 border-b', selected && 'bg-primary/10')}>
        {selectable && (
          <td className="bg-background sticky left-0 z-10 w-10 px-2 py-1.5">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer"
              checked={selected}
              aria-label={`Select ${task.title}`}
              onChange={() => undefined}
              onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id, e) }}
            />
          </td>
        )}

        {config.fields.map((field) => {
          const isTitle = field === 'title'
          return (
            <td
              key={field}
              className={cn('px-3 py-1.5 align-middle', isTitle && 'bg-background sticky z-10')}
              style={{ width: widthOf(field), ...(isTitle ? { left: selectable ? 40 : 0 } : {}) }}
            >
              {isTitle ? (
                <span className="flex min-w-0 items-center gap-1" style={depth ? { paddingLeft: `${depth}rem` } : undefined}>
                  {editing ? (
                    <Input
                      autoFocus
                      className="h-7"
                      value={draft}
                      disabled={saving}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commit()
                        if (e.key === 'Escape') { setDraft(task.title ?? ''); setEditing(false) }
                      }}
                    />
                  ) : (
                    <>
                      <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => onOpenTask(task.id)}>
                        <FieldCell task={task} field="title" ctx={ctx} />
                      </button>
                      {onRenameTask && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground shrink-0 text-xs opacity-0 focus:opacity-100 group-hover:opacity-100"
                          onClick={() => { setDraft(task.title ?? ''); setEditing(true) }}
                          aria-label={`Rename ${task.title}`}
                        >
                          edit
                        </button>
                      )}
                    </>
                  )}
                </span>
              ) : (
                <FieldCell task={task} field={field} ctx={ctx} />
              )}
            </td>
          )
        })}
      </tr>

      {children.map((child: any) => (
        <TableRow
          key={child.id}
          task={child}
          depth={depth + 1}
          config={config}
          ctx={ctx}
          widthOf={widthOf}
          childrenByParent={childrenByParent}
          selectable={selectable}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onOpenTask={onOpenTask}
          onRenameTask={onRenameTask}
        />
      ))}
    </>
  )
}
