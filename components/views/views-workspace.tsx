'use client'

// The Views workspace - one configuration, four layouts.
//
// Prompt E's rule, in one screen: THE VIEW IS NOT THE DATA. Every layout below renders the same
// `ViewConfig` through the same `runView` pipeline in lib/view-config.ts, so a question asked in
// the table and the same question asked on the calendar cannot give different answers. Switching
// layout changes only how the answer is drawn.
//
// ⚠️ FILTERING IS CLIENT-SIDE, ON ROWS RLS ALREADY DECIDED. Nothing here re-implements
// visibility: the server component fetches with the caller's own session, so a private board's
// tasks were never in the array. That also means every count on this screen is a count of what
// this person can see, which is the honest number, and is why the header says "you can see"
// rather than implying a total.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Filter, Info, Layers, X } from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/shell/app-shell'
import { EmptyState, ErrorState } from '@/components/shell/states'
import { buildWorkspaceNav, boardHref } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { buildCreateCommands, type Command } from '@/components/shell/commands'
import { ThemeControls } from '@/components/theme/theme-controls'
import { HelpDialog } from '@/components/shell/help-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDensity } from '@/components/shell/use-density'
import { useAppModules } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { allows } from '@/lib/capabilities'
import type { ShellData } from '@/lib/shell-data'
import { createClient } from '@/lib/supabase/client'
import { classifyWrite, didWrite, writeFailureMessage } from '@/lib/rls-write'
import {
  buildBoardTree, flattenBoardTree, resolveScopedBoardIds, scopeBoardCount, taskInScope,
} from '@/lib/board-hierarchy'
import {
  createSavedView, deleteSavedView, loadSavedViews, updateSavedView,
  type SavedView, type ViewScope,
} from '@/lib/saved-views'
import {
  CURRENT_USER, DEFAULT_VIEW_CONFIG, UNASSIGNED, activeFilterCount, configsEqual,
  customFilterField, describeFilter, incompleteFilters, normalizeViewConfig, runView,
  type EvalContext, type FieldKind, type GroupField, type ViewConfig,
} from '@/lib/view-config'
import { FilterBuilder, type FilterOption } from './filter-builder'
import { ViewToolbar } from './view-toolbar'
import { SavedViewBar } from './saved-view-bar'
import { ListLayout } from './list-layout'
import { TableLayout } from './table-layout'
import { KanbanLayout } from './kanban-layout'
import { CalendarLayout } from './calendar-layout'
import { dueDateForStorage } from '@/lib/calendar-grid'

/** Custom field types (114) mapped onto the filter vocabulary's four kinds. */
function kindForFieldType(fieldType: string): FieldKind {
  switch (fieldType) {
    case 'number': return 'number'
    case 'date': case 'datetime': return 'date'
    case 'checkbox': case 'select': case 'multi_select': return 'select'
    default: return 'text'
  }
}

interface ViewsWorkspaceProps {
  user: any
  tasks: any[]
  boards: any[]
  users: any[]
  statuses: any[]
  tags: any[]
  /** Every column the caller can see, so a status move can find this board's column. */
  columns: any[]
  fieldDefinitions: any[]
  fieldValues: any[]
  shell?: ShellData
  /** The server's instant, so elapsed-time maths does not differ between render passes. */
  now: string
  loadFailed?: boolean
}

export default function ViewsWorkspace({
  user, tasks, boards, users, statuses, tags, columns, fieldDefinitions, fieldValues,
  shell, now, loadFailed = false,
}: ViewsWorkspaceProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const role = user?.role ?? 'user'

  const [config, setConfig] = useState<ViewConfig>(() => ({ ...DEFAULT_VIEW_CONFIG, layout: 'table' }))
  const [views, setViews] = useState<SavedView[]>([])
  const [activeView, setActiveView] = useState<SavedView | null>(null)
  const [busy, setBusy] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
  const [rows, setRows] = useState(tasks)

  const { density, setDensity } = useDensity(user?.id ?? 'anon')
  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)

  // The server's instant, taken once. Calling new Date() during render makes the server and
  // client disagree on every date-derived class - a hydration error, not a cosmetic one.
  const nowDate = useMemo(() => new Date(now), [now])

  useEffect(() => { setRows(tasks) }, [tasks])

  /* ── Saved views ─────────────────────────────────────────────────────────────────── */

  const refreshViews = useCallback(async () => {
    const { views: loaded, error } = await loadSavedViews(supabase)
    // An error is kept, not swallowed: an empty picker and a failed query look identical, and
    // "you have no saved views" is the most reassuring possible way to report a broken one.
    if (error) toast.error('Could not load your saved views', { description: error })
    else setViews(loaded)
  }, [supabase])

  useEffect(() => { void refreshViews() }, [refreshViews])

  const dirty = activeView ? !configsEqual(config, activeView.config) : false

  const selectView = (view: SavedView | null) => {
    setActiveView(view)
    setConfig(view ? { ...view.config, search: '' } : { ...DEFAULT_VIEW_CONFIG, layout: 'table' })
    setSelectedIds([])
  }

  const patch = useCallback((next: Partial<ViewConfig>) => {
    setConfig((prev) => normalizeViewConfig({ ...prev, ...next }))
  }, [])

  /* ── Custom fields ───────────────────────────────────────────────────────────────── */

  const customFields = useMemo(
    () => (fieldDefinitions ?? []).filter((f: any) => !f.is_archived),
    [fieldDefinitions],
  )

  const fieldIdToKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const definition of customFields) map.set(definition.id, definition.key)
    return map
  }, [customFields])

  const customValues = useMemo(() => {
    const out: Record<string, Record<string, unknown>> = {}
    for (const row of fieldValues ?? []) {
      const key = fieldIdToKey.get(row.field_id)
      if (!key) continue
      ;(out[row.task_id] ??= {})[key] = row.value
    }
    return out
  }, [fieldValues, fieldIdToKey])

  const extraFields = useMemo(
    () => customFields.map((f: any) => ({
      field: customFilterField(f.key),
      label: f.name,
      kind: kindForFieldType(f.field_type),
    })),
    [customFields],
  )

  /* ── Scope ───────────────────────────────────────────────────────────────────────── */

  const boardTree = useMemo(() => flattenBoardTree(buildBoardTree(boards)), [boards])
  const scopedBoardIds = useMemo(
    () => resolveScopedBoardIds(boards, config.boardIds, config.descendants),
    [boards, config.boardIds, config.descendants],
  )
  const spanCount = useMemo(
    () => scopeBoardCount(boards, config.boardIds, config.descendants),
    [boards, config.boardIds, config.descendants],
  )

  const inScope = useMemo(
    () => rows.filter((task) => taskInScope(task, scopedBoardIds)),
    [rows, scopedBoardIds],
  )

  /* ── The pipeline ────────────────────────────────────────────────────────────────── */

  const ctx: EvalContext = useMemo(() => ({
    currentUserId: user?.id ?? null,
    statuses,
    users,
    boards,
    now: nowDate,
    customValues,
  }), [user?.id, statuses, users, boards, nowDate, customValues])

  const result = useMemo(() => runView(inScope, config, ctx), [inScope, config, ctx])

  const childrenByParent = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const task of inScope) {
      if (!task.parent_task_id) continue
      const existing = map.get(task.parent_task_id)
      if (existing) existing.push(task)
      else map.set(task.parent_task_id, [task])
    }
    return map
  }, [inScope])

  const parentTitles = useMemo(() => {
    const byId = new Map(inScope.map((t: any) => [t.id, t.title]))
    const map = new Map<string, string>()
    for (const task of inScope) {
      if (task.parent_task_id && byId.has(task.parent_task_id)) {
        map.set(task.id, byId.get(task.parent_task_id) as string)
      }
    }
    return map
  }, [inScope])

  /* ── Filter option lists ─────────────────────────────────────────────────────────── */

  const optionsFor = useCallback((field: string): FilterOption[] | undefined => {
    switch (field) {
      case 'assignee':
      case 'created_by':
        return [
          // @me first because it is the option people reach for, and it is what makes a
          // SHARED view mean "mine" for each reader rather than for whoever saved it.
          ...(field === 'assignee' ? [{ value: CURRENT_USER, label: 'Me' }, { value: UNASSIGNED, label: 'Nobody' }] : [{ value: CURRENT_USER, label: 'Me' }]),
          ...users.map((u: any) => ({ value: u.id, label: u.full_name || u.email || 'Unknown' })),
        ]
      case 'priority':
        return [
          { value: '1', label: '1 - Highest' }, { value: '2', label: '2 - High' },
          { value: '3', label: '3 - Medium' }, { value: '4', label: '4 - Low' },
          { value: '5', label: '5 - Lowest' },
        ]
      // Every status, archived included. Filtering the lookup itself is how an archived status
      // stops resolving and silently reclassifies its work - lib/crm.ts records the same trap.
      case 'status':
        return statuses.map((s: any) => ({ value: s.key, label: s.label }))
      case 'status_category':
        return [
          { value: 'backlog', label: 'Backlog' }, { value: 'planned', label: 'Planned' },
          { value: 'started', label: 'Started' }, { value: 'completed', label: 'Completed' },
          { value: 'cancelled', label: 'Cancelled' },
        ]
      case 'board':
        return boards.map((b: any) => ({ value: b.id, label: b.title }))
      case 'tag':
        return tags.map((t: any) => ({ value: t.id, label: t.name }))
      case 'type':
        return [{ value: 'task', label: 'Task' }, { value: 'subtask', label: 'Subtask' }]
      default:
        return undefined
    }
  }, [users, statuses, boards, tags])

  const kindFor = useCallback((field: string): FieldKind | undefined =>
    extraFields.find((f) => f.field === field)?.kind, [extraFields])

  const labelForValue = useCallback((field: string, value: string): string => {
    const found = optionsFor(field)?.find((o) => o.value === value)
    return found?.label ?? value
  }, [optionsFor])

  /* ── Writes ──────────────────────────────────────────────────────────────────────── */

  /** Patch one task locally, so an optimistic change is visible before the round trip. */
  const patchRow = (taskId: string, changes: Record<string, unknown>) => {
    setRows((prev) => prev.map((t: any) => (t.id === taskId ? { ...t, ...changes } : t)))
  }

  const renameTask = useCallback(async (taskId: string, title: string): Promise<boolean> => {
    const before = rows.find((t: any) => t.id === taskId)
    patchRow(taskId, { title })
    const write = await supabase.from('tasks').update({ title }).eq('id', taskId).select('id, title')
    // A title is not an input to can_view_task, so a zero-row result is unambiguously a
    // refusal and needs no visibility probe (lib/rls-write.ts).
    const outcome = await classifyWrite(write)
    if (!didWrite(outcome)) {
      patchRow(taskId, { title: before?.title })
      const message = writeFailureMessage(outcome, 'title')
      if (message) toast.error(message.title, { description: message.description })
      return false
    }
    return true
  }, [rows, supabase])

  const rescheduleTask = useCallback(async (taskId: string, dueDate: string | null): Promise<boolean> => {
    const before = rows.find((t: any) => t.id === taskId)
    // The calendar hands back the cell's `YYYY-MM-DD`. Store it the same way every other writer
    // does, so this column holds one shape rather than two. See lib/calendar-grid.ts.
    const stored = dueDateForStorage(dueDate)
    patchRow(taskId, { due_date: stored })
    const write = await supabase.from('tasks').update({ due_date: stored }).eq('id', taskId).select('id, due_date')
    const outcome = await classifyWrite(write)
    if (!didWrite(outcome)) {
      patchRow(taskId, { due_date: before?.due_date })
      const message = writeFailureMessage(outcome, 'due date')
      if (message) toast.error(message.title, { description: message.description })
      return false
    }
    return true
  }, [rows, supabase])

  const moveTask = useCallback(async (taskId: string, group: GroupField, targetKey: string): Promise<boolean> => {
    const task = rows.find((t: any) => t.id === taskId)
    if (!task) return false

    if (group === 'priority') {
      const priority = targetKey === '__none__' ? null : Number(targetKey)
      patchRow(taskId, { priority })
      const write = await supabase.from('tasks').update({ priority }).eq('id', taskId).select('id, priority')
      const outcome = await classifyWrite(write)
      if (!didWrite(outcome)) {
        patchRow(taskId, { priority: task.priority })
        const message = writeFailureMessage(outcome, 'priority')
        if (message) toast.error(message.title, { description: message.description })
        return false
      }
      return true
    }

    if (group === 'status') {
      // Status lives in `columns.status_key` (migration 063), so moving between status columns
      // means moving the task to THIS BOARD's column carrying that status. A board that has no
      // column for the target status cannot host the move, and saying so is better than a
      // silent no-op.
      const target = columns.find((c: any) => c.board_id === task.board_id && c.status_key === targetKey)
      if (!target) {
        toast.error('That status has no column on this board', {
          description: 'Add a column for it on the board first, or group by something else.',
        })
        return false
      }
      patchRow(taskId, { column_id: target.id, column: { ...task.column, status_key: targetKey } })
      const write = await supabase.from('tasks').update({ column_id: target.id }).eq('id', taskId).select('id, column_id')
      const outcome = await classifyWrite(write)
      if (!didWrite(outcome)) {
        patchRow(taskId, { column_id: task.column_id, column: task.column })
        const message = writeFailureMessage(outcome, 'status')
        if (message) toast.error(message.title, { description: message.description })
        return false
      }
      return true
    }

    if (group === 'assignee') {
      // Reassigning replaces the whole set, which is what dropping a card into one person's
      // column means. Delete then insert, and both are checked: a zero-row write on either
      // half is a refusal, and a half-applied reassignment is worse than none.
      const previous = Array.isArray(task.task_assignees) ? task.task_assignees : []
      const next = targetKey === '__none__' ? [] : [{ user_id: targetKey }]
      patchRow(taskId, { task_assignees: next })

      const removal = await supabase.from('task_assignees').delete().eq('task_id', taskId).select('task_id')
      if (removal.error) {
        patchRow(taskId, { task_assignees: previous })
        toast.error('Could not change the assignee', { description: removal.error.message })
        return false
      }

      if (targetKey !== '__none__') {
        const insert = await supabase
          .from('task_assignees')
          .insert({ task_id: taskId, user_id: targetKey })
          .select('task_id')
        const outcome = await classifyWrite(insert)
        if (!didWrite(outcome)) {
          patchRow(taskId, { task_assignees: previous })
          const message = writeFailureMessage(outcome, 'assignee')
          if (message) toast.error(message.title, { description: message.description })
          return false
        }
      }
      return true
    }

    return false
  }, [rows, supabase, columns])

  /* ── View persistence ────────────────────────────────────────────────────────────── */

  const handleCreate = async (input: { name: string; description: string; scope: ViewScope }) => {
    setBusy(true)
    const out = await createSavedView(supabase, user?.id, {
      name: input.name,
      description: input.description,
      scope: input.scope,
      // A view scoped to exactly one board belongs to it; anything else is cross-board.
      boardId: config.boardIds.length === 1 ? config.boardIds[0] : null,
      config,
    })
    setBusy(false)
    if (out.message) { toast.error(out.message.title, { description: out.message.description }); return }
    if (out.view) {
      setViews((prev) => [...prev, out.view!])
      setActiveView(out.view)
      toast.success(`Saved "${out.view.name}"`)
    }
  }

  const handleUpdate = async (view: SavedView) => {
    setBusy(true)
    const out = await updateSavedView(supabase, view.id, { config })
    setBusy(false)
    if (out.message) { toast.error(out.message.title, { description: out.message.description }); return }
    if (out.view) {
      setViews((prev) => prev.map((v) => (v.id === out.view!.id ? out.view! : v)))
      setActiveView(out.view)
      toast.success(`Updated "${out.view.name}"`)
    }
  }

  const handleDelete = async (view: SavedView) => {
    setBusy(true)
    const out = await deleteSavedView(supabase, view.id)
    setBusy(false)
    if (out.message) { toast.error(out.message.title, { description: out.message.description }); return }
    setViews((prev) => prev.filter((v) => v.id !== view.id))
    if (activeView?.id === view.id) selectView(null)
    toast.success(`Deleted "${view.name}"`, { description: 'No task was changed.' })
  }

  /* ── Selection ───────────────────────────────────────────────────────────────────── */

  const toggleSelect = (taskId: string) => {
    setSelectedIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]))
  }

  const selectAll = (ids: string[], selected: boolean) => {
    setSelectedIds(selected ? Array.from(new Set(ids)) : [])
  }

  const openTask = (taskId: string) => {
    const task = rows.find((t: any) => t.id === taskId)
    if (!task?.board_id) return
    // Deep-link into the board rather than rebuilding the task modal here. boardHref keys off
    // the viewer's PLATFORM role: /dashboard/board/<id> passes isAdmin={false} deliberately, so
    // sending an admin there silently strips controls they are entitled to.
    router.push(`${boardHref(role, task.board_id)}?task=${taskId}`)
  }

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  /* ── Shell ───────────────────────────────────────────────────────────────────────── */

  const favoriteBoardHref = useCallback((boardId: string) => boardHref(role, boardId), [role])
  const { resolved: favoriteItems } = useFavorites(user?.id, { boardHref: favoriteBoardHref })

  const groups: SidebarNavGroup[] = useMemo(
    () => buildWorkspaceNav({
      role,
      modules,
      canUseMarketingCalendar: isAdmin || calendars.length > 0,
      canViewAudit: allows({ userId: user?.id ?? '', platformRole: role }, 'audit.view'),
    }),
    [role, user?.id, modules, isAdmin, calendars.length],
  )

  const commands: Command[] = useMemo(
    () => buildCreateCommands({ role, modules }),
    [role, modules],
  )

  const filterCount = activeFilterCount(config)
  const unfinished = incompleteFilters(config)
  const completeFilters = config.filters.filter((c) => !unfinished.includes(c))

  // Bulk operations need one board's columns to resolve a status, and "move to another board"
  // needs a board to exclude. A selection spanning boards therefore cannot be acted on as one
  // batch, and saying so beats a disabled button with no reason (ATLAS_01 10.2).
  const selectionBoards = useMemo(
    () => Array.from(new Set(selectedIds.map((id) => rows.find((t: any) => t.id === id)?.board_id).filter(Boolean))),
    [selectedIds, rows],
  )

  return (
    <AppShell
      user={{ id: user?.id, role: user?.role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="views"
      breadcrumbs={[{ label: 'Views' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<><ThemeControls /><HelpDialog /></>}
    >
      <div className="space-y-4 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Views</h1>
          <p className="text-muted-foreground text-sm">
            One set of filters, four ways to look at it. Everything here is work you can see.
          </p>
        </header>

        {loadFailed ? (
          <ErrorState
            title="Could not load your work"
            description="The query failed, so this is not an empty workspace - it is a broken one. Reload to try again."
          />
        ) : (
          <>
            <SavedViewBar
              // ⚠️ Every view this person can see, NOT viewsForBoard(...) filtered by the
              // current scope. A view that scopes itself to a board carries board_id, and this
              // screen opens with no board selected - so filtering the picker by the current
              // scope hides exactly the views that would SET that scope, and a view saved while
              // scoped to a board became unreachable on the next visit. Found in a real browser,
              // not in review. viewsForBoard stays for a picker embedded IN a board, where the
              // board is fixed and filtering is the right behaviour.
              views={views}
              activeView={activeView}
              config={config}
              dirty={dirty}
              currentUserId={user?.id ?? null}
              isAdmin={isAdmin}
              boardId={config.boardIds.length === 1 ? config.boardIds[0] : null}
              onSelect={selectView}
              onCreate={handleCreate}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onResetToSaved={() => activeView && selectView(activeView)}
              busy={busy}
            />

            <div className="flex flex-wrap items-center gap-2">
              {/* Board scope, rendered as the tree so a parent and its children read as one thing */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" id="view-scope" variant="outline" size="sm" className="h-8">
                    <Layers className="mr-1 h-4 w-4" aria-hidden />
                    {config.boardIds.length === 0
                      ? 'All boards'
                      : `${config.boardIds.length} board${config.boardIds.length === 1 ? '' : 's'}`}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs">
                    Scope. Leave empty for everything you can see.
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {boardTree.map(({ board, depth }) => (
                    <DropdownMenuCheckboxItem
                      key={board.id}
                      checked={config.boardIds.includes(board.id)}
                      onCheckedChange={(checked) =>
                        patch({
                          boardIds: checked
                            ? [...config.boardIds, board.id]
                            : config.boardIds.filter((id) => id !== board.id),
                        })
                      }
                      onSelect={(e) => e.preventDefault()}
                    >
                      <span style={{ paddingLeft: `${depth * 0.75}rem` }} className="truncate">
                        {board.title as string}
                      </span>
                    </DropdownMenuCheckboxItem>
                  ))}
                  {boards.length === 0 && <DropdownMenuLabel>No boards you can see.</DropdownMenuLabel>}
                </DropdownMenuContent>
              </DropdownMenu>

              <ViewToolbar
                config={config}
                onChange={patch}
                density={density}
                onDensityChange={setDensity}
                descendantsAvailable={config.boardIds.length > 0}
                scopeBoardCount={spanCount}
                extraFields={extraFields.map((f) => ({ field: f.field, label: f.label }))}
              />

              <Button
                type="button"
                id="view-filters"
                variant={filterCount > 0 ? 'default' : 'outline'}
                size="sm"
                className="h-8"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                <Filter className="mr-1 h-4 w-4" aria-hidden />
                Filters
                {filterCount > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">{filterCount}</Badge>
                )}
              </Button>

              <Input
                id="view-search"
                className="h-8 w-[200px]"
                placeholder="Search titles"
                value={config.search}
                onChange={(e) => patch({ search: e.target.value })}
                aria-label="Search titles and descriptions"
              />
            </div>

            {showFilters && (
              <div className="rounded-md border p-3">
                <FilterBuilder
                  config={config}
                  onChange={patch}
                  source={{ optionsFor, kindFor, extraFields }}
                />
              </div>
            )}

            {/* Active filters as removable chips, each showing its ABSOLUTE value. A filter you
                cannot see is a filter you will blame the data for. */}
            {(completeFilters.length > 0 || config.search.trim()) && !showFilters && (
              <div className="flex flex-wrap items-center gap-1.5">
                {config.search.trim() && (
                  <Badge variant="secondary" className="gap-1">
                    Search: {config.search.trim()}
                    <button type="button" onClick={() => patch({ search: '' })} aria-label="Clear search">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </Badge>
                )}
                {completeFilters.map((condition) => (
                  <Badge key={condition.id} variant="secondary" className="gap-1">
                    {describeFilter(condition, ctx, labelForValue)}
                    <button
                      type="button"
                      onClick={() => patch({ filters: config.filters.filter((c) => c.id !== condition.id) })}
                      aria-label="Remove this filter"
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </Badge>
                ))}
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 text-xs"
                  onClick={() => patch({ filters: [], search: '' })}
                >
                  Clear all
                </Button>
              </div>
            )}

            {unfinished.length > 0 && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Info className="h-3.5 w-3.5" aria-hidden />
                {unfinished.length} condition{unfinished.length === 1 ? ' is' : 's are'} not
                filtering yet because {unfinished.length === 1 ? 'it has' : 'they have'} no value.
              </p>
            )}

            <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              <span id="view-count">
                <strong className="text-foreground">{result.tasks.length}</strong> shown
                {result.hiddenCount > 0 && ` · ${result.hiddenCount} hidden by filters`}
                {` · across ${spanCount} board${spanCount === 1 ? '' : 's'} you can see`}
              </span>
              {selectedIds.length > 0 && (
                <span>
                  {selectedIds.length} selected
                  {selectionBoards.length > 1 && ' on more than one board'}
                  <Button type="button" variant="ghost" size="sm" className="ml-1 h-5 text-xs" onClick={() => setSelectedIds([])}>
                    Clear
                  </Button>
                </span>
              )}
            </div>

            {selectedIds.length > 0 && selectionBoards.length > 1 && (
              <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-xs">
                Bulk changes run one board at a time, because a status and a destination column
                only mean something on a particular board. Narrow the scope to one board to act
                on this selection.
              </p>
            )}

            {result.tasks.length === 0 ? (
              <EmptyState
                title={filterCount > 0 ? 'Nothing matches these filters' : 'No work here yet'}
                description={
                  filterCount > 0
                    ? 'Every task is hidden by the conditions above, not missing. Remove a filter to widen it.'
                    : 'Once there is work on the boards you can see, it shows up here.'
                }
              />
            ) : config.layout === 'list' ? (
              <ListLayout
                groups={result.groups} config={config} ctx={ctx} density={density}
                childrenByParent={childrenByParent} selectable selectedIds={selectedIds}
                onToggleSelect={(id) => toggleSelect(id)} onOpenTask={openTask}
                collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup}
              />
            ) : config.layout === 'table' ? (
              <TableLayout
                groups={result.groups} config={config} ctx={ctx}
                childrenByParent={childrenByParent} selectable selectedIds={selectedIds}
                onToggleSelect={(id) => toggleSelect(id)} onSelectAll={selectAll}
                onOpenTask={openTask}
                onSortChange={(sort) => patch({ sort })}
                onFieldsChange={(fields) => patch({ fields })}
                onRenameTask={renameTask}
                extraFieldLabels={Object.fromEntries(extraFields.map((f) => [f.field, f.label]))}
                collapsedGroups={collapsedGroups} onToggleGroup={toggleGroup}
              />
            ) : config.layout === 'kanban' ? (
              <KanbanLayout
                groups={result.groups} config={config} ctx={ctx} density={density}
                parentTitles={parentTitles} selectable selectedIds={selectedIds}
                onToggleSelect={(id) => toggleSelect(id)} onOpenTask={openTask}
                onMoveTask={moveTask}
              />
            ) : (
              <CalendarLayout
                tasks={result.tasks} config={config} ctx={ctx} density={density}
                onOpenTask={openTask} onReschedule={rescheduleTask} canReschedule
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
