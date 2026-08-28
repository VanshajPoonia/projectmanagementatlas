'use client'

// The backlog, and the planning view built from it.
//
// Prompt G asks the backlog for prioritized ordering, quick create, search, filters, bulk
// selection, assignment to a window, and epic/feature grouping. All seven are here, and none
// of them introduce a second data model:
//
//   - ORDERING is the board's own `tasks.position`. A backlog with its own rank column would
//     be two orders that must agree forever, which is exactly what 115 refused for relations.
//   - GROUPING is `parent_task_id` (113's hierarchy), not an `epic_id`. Same reasoning.
//   - FILTERS reuse the status catalog and the assignee rows the board already uses.
//
// ⚠️ Every list here is a list of what RLS let through. An empty backlog and a backlog whose
// items this person cannot see look identical, so nothing below treats emptiness as a fact
// about the board - the empty state says "nothing here you can see", not "nothing here".

import { useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/shell/states'
import { WorkItemRow } from './work-item-row'
import {
  capacityStatus, formatEstimate, groupIntoSwimlanes, isOpenTask, orderBacklog, sprintNoun,
  sumEstimates, planBlockedReason,
  type AgileSettings, type SprintLike,
} from '@/lib/agile'
import type { StatusCatalog } from '@/lib/task-status'
import type { Density } from '@/components/shell/density'

const ANY = '__any__'

interface Props {
  settings: AgileSettings
  statuses: StatusCatalog
  statusOptions: { key: string; label: string; is_archived: boolean }[]
  users: { id: string; full_name?: string | null; email?: string | null }[]
  workItemTypes: { key: string; name: string; is_agile_eligible: boolean; is_active: boolean }[]
  density: Density
  /** Work on this board that is NOT in any live window. */
  backlog: any[]
  /** The window being planned into, if any. */
  sprint: (SprintLike & { id: string }) | null
  /** Work currently in that window. */
  sprintTasks: any[]
  canManage: boolean
  onOpenTask: (id: string) => void
  onAdd: (taskIds: string[]) => void
  onRemove: (taskIds: string[]) => void
  onEstimate: (taskId: string, value: number | null) => void
  onQuickCreate: (title: string) => void
  busy?: boolean
  /** Planning shows both panes; backlog shows one. */
  mode: 'backlog' | 'planning'
}

export function BacklogPanel({
  settings, statuses, statusOptions, users, workItemTypes, density,
  backlog, sprint, sprintTasks, canManage, onOpenTask, onAdd, onRemove, onEstimate,
  onQuickCreate, busy, mode,
}: Props) {
  const [search, setSearch] = useState('')
  const [statusKey, setStatusKey] = useState(ANY)
  const [assignee, setAssignee] = useState(ANY)
  const [typeKey, setTypeKey] = useState(ANY)
  const [openOnly, setOpenOnly] = useState(true)
  const [grouped, setGrouped] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [draft, setDraft] = useState('')

  const term = settings.terminology
  const unit = settings.estimate_unit

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return orderBacklog(backlog.filter((task: any) => {
      if (openOnly && !isOpenTask(task, statuses)) return false
      if (needle && !`${task.title} ${task.description ?? ''}`.toLowerCase().includes(needle)) return false
      if (statusKey !== ANY && (task.column?.status_key ?? task.status) !== statusKey) return false
      if (typeKey !== ANY && (task.type_key ?? 'task') !== typeKey) return false
      if (assignee !== ANY) {
        const ids = [task.assigned_to, ...((task.task_assignees ?? []).map((a: any) => a.user_id))].filter(Boolean)
        if (assignee === '__unassigned__' ? ids.length > 0 : !ids.includes(assignee)) return false
      }
      return true
    }))
  }, [backlog, search, statusKey, assignee, typeKey, openOnly, statuses])

  const lanes = useMemo(() => groupIntoSwimlanes(filtered), [filtered])

  const sprintTotals = useMemo(() => sumEstimates(sprintTasks), [sprintTasks])
  const capacity = useMemo(
    () => capacityStatus({
      planned: sprintTotals.total,
      capacity: sprint?.capacity ?? null,
      unestimated: sprintTotals.unestimated,
      unit,
      mode: settings.capacity_mode,
    }),
    [sprintTotals, sprint?.capacity, unit, settings.capacity_mode],
  )

  const selectedRows = filtered.filter((t: any) => selected.includes(t.id))
  const selectedTotals = sumEstimates(selectedRows)
  const wouldBe = capacityStatus({
    planned: sprintTotals.total + selectedTotals.total,
    capacity: sprint?.capacity ?? null,
    unestimated: sprintTotals.unestimated + selectedTotals.unestimated,
    unit,
    mode: settings.capacity_mode,
  })

  const toggle = (id: string, next: boolean) =>
    setSelected((prev) => (next ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)))

  const addSelected = () => {
    if (!sprint || !selected.length) return
    onAdd(selected)
    setSelected([])
  }

  const rowFor = (task: any, where: 'backlog' | 'sprint') => {
    const blocked = planBlockedReason(task.type_key, workItemTypes, term)
    const actions: { label: string; onSelect: () => void; destructive?: boolean }[] = []
    if (canManage && sprint && where === 'backlog' && !blocked) {
      actions.push({ label: `Add to ${sprint.title}`, onSelect: () => onAdd([task.id]) })
    }
    if (canManage && where === 'sprint') {
      actions.push({ label: `Remove from ${sprintNoun(term)}`, onSelect: () => onRemove([task.id]), destructive: true })
    }
    actions.push({ label: 'Open work item', onSelect: () => onOpenTask(task.id) })

    return (
      <div key={task.id} className="space-y-1">
        <WorkItemRow
          task={task}
          unit={unit}
          statuses={statuses}
          density={density}
          selected={where === 'backlog' ? selected.includes(task.id) : undefined}
          onToggleSelect={where === 'backlog' && canManage && sprint ? toggle : undefined}
          onOpen={onOpenTask}
          actions={actions}
          onEstimate={onEstimate}
          canEstimate={canManage}
          trailing={
            canManage && sprint && where === 'backlog' && !blocked ? (
              <Button
                variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => onAdd([task.id])} disabled={busy}
              >
                Add
              </Button>
            ) : canManage && where === 'sprint' ? (
              <Button
                variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => onRemove([task.id])} disabled={busy}
              >
                Remove
              </Button>
            ) : null
          }
        />
        {blocked && where === 'backlog' && (
          <p className="text-muted-foreground pl-6 text-xs">{blocked}</p>
        )}
      </div>
    )
  }

  const backlogList = (
    <div className="space-y-2">
      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing here you can see"
          description={
            backlog.length === 0
              ? `No work on this board is outside a ${sprintNoun(term)} yet.`
              : 'No work item matches these filters.'
          }
        />
      ) : grouped ? (
        lanes.map((lane) => (
          <section key={lane.id ?? '__ungrouped__'} className="space-y-2">
            <h4 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide uppercase">
              {lane.title}
              <Badge variant="outline" className="text-[10px]">{lane.items.length}</Badge>
            </h4>
            <div className="space-y-2 pl-2">{lane.items.map((t) => rowFor(t, 'backlog'))}</div>
          </section>
        ))
      ) : (
        filtered.map((t: any) => rowFor(t, 'backlog'))
      )}
    </div>
  )

  return (
    <div className={mode === 'planning' ? 'grid gap-6 lg:grid-cols-2' : 'space-y-4'}>
      {/* ── Backlog pane ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Backlog</h3>
            <p className="text-muted-foreground text-xs">
              {filtered.length} item{filtered.length === 1 ? '' : 's'}
              {' · '}
              {formatEstimate(sumEstimates(filtered).total, unit)}
              {sumEstimates(filtered).unestimated > 0 && `, ${sumEstimates(filtered).unestimated} unestimated`}
            </p>
          </div>
          <Button
            variant={grouped ? 'secondary' : 'outline'} size="sm"
            onClick={() => setGrouped((g) => !g)}
            id="agile-group-toggle"
          >
            {grouped ? 'Flat list' : 'Group by parent'}
          </Button>
        </header>

        {canManage && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const title = draft.trim()
              if (!title) return
              onQuickCreate(title)
              setDraft('')
            }}
          >
            <Input
              id="agile-quick-create"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a work item and press Enter"
              maxLength={500}
            />
            <Button type="submit" size="icon" variant="outline" disabled={!draft.trim() || busy} aria-label="Add work item">
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        )}

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[10rem] flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
            <Input
              id="agile-backlog-search"
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the backlog" className="h-9 pl-7"
            />
          </div>
          <Select value={statusKey} onValueChange={setStatusKey}>
            <SelectTrigger id="agile-filter-status" className="h-9 w-[9rem]"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {/* Every status, archived included - filtering the lookup is how work in an
                  archived status silently disappears from its own filter. */}
              {statusOptions.map((s) => (
                <SelectItem key={s.key} value={s.key}>{s.label}{s.is_archived ? ' (archived)' : ''}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={assignee} onValueChange={setAssignee}>
            <SelectTrigger id="agile-filter-assignee" className="h-9 w-[9rem]"><SelectValue placeholder="Assignee" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anyone</SelectItem>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name || u.email || 'Unnamed'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeKey} onValueChange={setTypeKey}>
            <SelectTrigger id="agile-filter-type" className="h-9 w-[8rem]"><SelectValue placeholder="Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any type</SelectItem>
              {workItemTypes.filter((t) => t.is_active).map((t) => (
                <SelectItem key={t.key} value={t.key}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={openOnly ? 'secondary' : 'outline'} size="sm" className="h-9"
            onClick={() => setOpenOnly((v) => !v)}
            id="agile-open-only"
          >
            {openOnly ? 'Open only' : 'All work'}
          </Button>
        </div>

        {selected.length > 0 && sprint && (
          <div className="bg-muted flex flex-wrap items-center gap-3 rounded-md p-3 text-sm">
            <span className="font-medium">{selected.length} selected</span>
            <span className="text-muted-foreground text-xs">
              {formatEstimate(selectedTotals.total, unit)}
              {selectedTotals.unestimated > 0 && `, ${selectedTotals.unestimated} unestimated`}
            </span>
            {wouldBe.state === 'over' && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Would take {sprint.title} {formatEstimate(wouldBe.over, unit)} over capacity.
                {wouldBe.blocks ? ' This board is set to refuse that.' : ' Allowed - this board only warns.'}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
              <Button
                size="sm" id="agile-add-selected"
                onClick={addSelected}
                disabled={busy || (wouldBe.blocks && wouldBe.state === 'over')}
              >
                Add to {sprint.title}
              </Button>
            </div>
          </div>
        )}

        {backlogList}
      </section>

      {/* ── Planning pane ───────────────────────────────────────────────────────── */}
      {mode === 'planning' && (
        <section className="space-y-3">
          <header>
            <h3 className="text-base font-semibold">
              {sprint ? sprint.title : `No ${sprintNoun(term)} selected`}
            </h3>
            {sprint ? (
              <p className="text-muted-foreground text-xs">
                {sprintTasks.length} item{sprintTasks.length === 1 ? '' : 's'} committed · {formatEstimate(sprintTotals.total, unit)}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Create a {sprintNoun(term)} to start planning work into it.
              </p>
            )}
          </header>

          {sprint && (
            <div
              id="agile-capacity-signal"
              className={`rounded-md border p-3 text-sm ${
                capacity.state === 'over'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                  : 'bg-muted/50'
              }`}
            >
              <p className="font-medium">
                {capacity.state === 'over' ? 'Over capacity' : capacity.state === 'at' ? 'At capacity' : capacity.state === 'under' ? 'Within capacity' : 'No capacity set'}
              </p>
              <p className="text-xs">{capacity.message}</p>
              {capacity.state === 'over' && (
                <p className="mt-1 text-xs">
                  {capacity.blocks
                    ? 'This board is configured to refuse work that goes over.'
                    : 'This is a warning only - you can still plan it in.'}
                </p>
              )}
            </div>
          )}

          {sprint && (
            <div className="space-y-2">
              {sprintTasks.length === 0 ? (
                <EmptyState
                  title={`Nothing planned into this ${sprintNoun(term)} yet`}
                  description="Add work from the backlog on the left. It stays the same work item - nothing is copied."
                />
              ) : (
                orderBacklog(sprintTasks).map((t: any) => rowFor(t, 'sprint'))
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
