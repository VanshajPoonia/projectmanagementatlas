'use client'

// Agile mode - Prompt G's optional Scrum/Kanban surface, in one screen.
//
// THREE LEVELS OF OPTIONAL, and all three are real:
//   1. The `agile` module (migration 123, seeded OFF). No nav item, and /agile redirects.
//   2. `board_agile_settings.is_enabled`, per board, off until somebody opts in. A marketing,
//      contracting, real-estate, finance or operations board is never shown the vocabulary.
//   3. The vocabulary itself - sprint / cycle / iteration - chosen per board.
//
// ONE UNDERLYING ITEM. Nothing here creates, copies or shadows a task. The backlog, the
// planning pane, the taskboard and the metrics all render `tasks` rows; membership is a
// pointer. Opening a work item deep-links into the board's own modal rather than a second
// editor that could drift from it.
//
// ⚠️ Everything below arrived through the caller's own session, so RLS already decided what is
// in these arrays. Nothing here re-implements visibility, and no empty list is treated as proof
// that something does not exist.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play, Plus, Settings2, Square } from 'lucide-react'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDensity } from '@/components/shell/use-density'
import { DENSITIES, DENSITY_LABELS } from '@/components/shell/density'
import { useAppModules, isModuleEnabled } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { allows } from '@/lib/capabilities'
import type { ShellData } from '@/lib/shell-data'
import { createClient } from '@/lib/supabase/client'
import {
  addToSprint, createSprint, deleteSprint, didWrite, loadAgileBoardData, moveBetweenSprints,
  removeFromSprint, reorderBacklog, sampleBurndown, saveAgileSettings, setSprintState,
  setTaskEstimate, updateSprint, writeFailureMessage,
  type SprintDraft, type SprintItemRow, type SprintRow,
} from '@/lib/agile-data'
import {
  agileActive, agileBoardStorageKey, defaultSprint, normalizeAgileSettings, planReorder,
  resolveAgileBoardId, sprintNoun, sprintNounPluralTitle, sprintNounTitle, sprintWindow,
  startBlockedReason, SPRINT_STATE_LABELS, type AgileSettings, type ReorderAction,
} from '@/lib/agile'
import type { BurndownSampleRow, SprintMetricsRow } from '@/lib/sprint-metrics'
import { BacklogPanel } from './backlog-panel'
import { SprintTaskboard } from './sprint-taskboard'
import { SprintMetricsPanel } from './sprint-metrics-panel'
import { SprintDialog } from './sprint-dialog'
import { AgileSettingsDialog } from './agile-settings-dialog'
import { AgileInfoButton } from './agile-info'

interface Props {
  user: any
  boards: any[]
  settings: any[]
  tasks: any[]
  statuses: any[]
  users: any[]
  workItemTypes: any[]
  columns: any[]
  shell?: ShellData
  now: string
  today: string
  loadFailed?: boolean
}

export default function AgileWorkspace({
  user, boards, settings: settingsRows, tasks, statuses, users, workItemTypes, columns,
  shell, now, today, loadFailed = false,
}: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  const role = user?.role ?? 'user'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const userId: string = user?.id ?? ''

  const { density, setDensity } = useDensity(userId || 'anon')
  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)

  /* ── Board selection ───────────────────────────────────────────────────────────── */

  const settingsByBoard = useMemo(() => {
    const map = new Map<string, AgileSettings>()
    for (const row of settingsRows ?? []) map.set(row.board_id, normalizeAgileSettings(row.board_id, row))
    return map
  }, [settingsRows])

  const boardOptions = useMemo(
    () => boards.map((b: any) => ({ id: b.id, title: b.title, agileEnabled: Boolean(settingsByBoard.get(b.id)?.is_enabled) })),
    [boards, settingsByBoard],
  )

  const [boardId, setBoardId] = useState<string | null>(null)

  useEffect(() => {
    // Resolved after mount so localStorage is readable. The requested board wins, then what
    // this user last chose, then a board that actually runs sprints - never simply the first
    // by name, which is how the marketing calendar opened on an empty calendar for months.
    let remembered: string | null = null
    try { remembered = window.localStorage.getItem(agileBoardStorageKey(userId)) } catch { /* private mode */ }
    setBoardId(resolveAgileBoardId({ requested: params.get('board'), remembered, boards: boardOptions }))
  }, [params, boardOptions, userId])

  const chooseBoard = (id: string) => {
    setBoardId(id)
    setSprintId(null)
    // Only an EXPLICIT switch is stored. Persisting the resolver's own fallback would pin a
    // user to the branch least likely to be right.
    try { window.localStorage.setItem(agileBoardStorageKey(userId), id) } catch { /* private mode */ }
  }

  const board = boards.find((b: any) => b.id === boardId) ?? null
  const [settings, setSettings] = useState<AgileSettings | null>(null)
  useEffect(() => {
    setSettings(boardId ? (settingsByBoard.get(boardId) ?? normalizeAgileSettings(boardId, null)) : null)
  }, [boardId, settingsByBoard])

  const term = settings?.terminology ?? 'sprint'

  /* ── Board-scoped data ─────────────────────────────────────────────────────────── */

  const [sprints, setSprints] = useState<SprintRow[]>([])
  const [items, setItems] = useState<SprintItemRow[]>([])
  const [snapshots, setSnapshots] = useState<SprintMetricsRow[]>([])
  const [samples, setSamples] = useState<BurndownSampleRow[]>([])
  const [sprintId, setSprintId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ⚠️ ONE loader, in lib/agile-data.ts. This used to be a second, inline copy of the same four
  // queries - which is precisely the shape Prompt E's audit found three times over
  // (reports-view, board-view and calendar-view each filtering tasks their own way, and
  // disagreeing). Two copies of one query do not stay identical; they diverge the first time
  // somebody adds a column to one of them.
  const refresh = useCallback(async (id: string) => {
    setLoading(true)
    const data = await loadAgileBoardData(supabase, id)
    setSprints(data.sprints)
    setItems(data.items)
    setSnapshots(data.snapshots)
    setSamples(data.samples)
    // Kept rather than discarded: a failed query rendered as "no sprints yet" is the most
    // reassuring possible way to tell somebody their workspace is broken.
    setLoadError(data.errorMessage)
    setLoading(false)
  }, [supabase])

  useEffect(() => { if (boardId) void refresh(boardId) }, [boardId, refresh])

  const sprint = useMemo(() => {
    if (!sprints.length) return null
    const picked = sprintId ? sprints.find((s) => s.id === sprintId) : null
    return picked ?? defaultSprint(sprints as any, today) as SprintRow | null
  }, [sprints, sprintId, today])

  // Take today's burndown point when a running window is opened. Migration 124 refreshes only
  // today and never rewrites a past day, so this is safe to call on every visit - the daily
  // cron alone cannot keep a chart current while people are working.
  useEffect(() => {
    if (!sprint || sprint.state !== 'active') return
    let cancelled = false
    void sampleBurndown(supabase, sprint.id).then((row) => {
      if (cancelled || !row) return
      setSamples((prev) => {
        const rest = prev.filter((s) => !(s.sprint_id === row.sprint_id && s.on_date === row.on_date))
        return [...rest, row].sort((a, b) => a.on_date.localeCompare(b.on_date))
      })
    })
    return () => { cancelled = true }
  }, [sprint, supabase])

  /* ── Derived work lists ────────────────────────────────────────────────────────── */

  const boardTasks = useMemo(
    () => tasks.filter((t: any) => t.board_id === boardId),
    [tasks, boardId],
  )

  const liveMembership = useMemo(() => items.filter((i) => !i.removed_at), [items])

  const sprintTaskIds = useMemo(
    () => new Set(liveMembership.filter((i) => i.sprint_id === sprint?.id).map((i) => i.task_id)),
    [liveMembership, sprint?.id],
  )
  const anySprintTaskIds = useMemo(() => new Set(liveMembership.map((i) => i.task_id)), [liveMembership])

  const sprintTasks = useMemo(
    () => boardTasks.filter((t: any) => sprintTaskIds.has(t.id)),
    [boardTasks, sprintTaskIds],
  )
  // The backlog is board work not in ANY live window - and never a subtask, which its parent
  // already carries (113's is_agile_eligible, mirrored here and enforced by 123's trigger).
  const backlog = useMemo(
    () => boardTasks.filter((t: any) => !anySprintTaskIds.has(t.id) && !t.parent_task_id),
    [boardTasks, anySprintTaskIds],
  )

  const boardColumns = useMemo(
    () => columns.filter((c: any) => c.board_id === boardId),
    [columns, boardId],
  )

  const members = useMemo(
    () => items.filter((i) => i.sprint_id === sprint?.id).map((i) => ({
      task_id: i.task_id,
      committed: i.committed,
      estimate_at_commit: i.estimate_at_commit === null ? null : Number(i.estimate_at_commit),
      removed_at: i.removed_at,
    })),
    [items, sprint?.id],
  )

  /* ── Writes ────────────────────────────────────────────────────────────────────── */

  const report = (outcome: any, ok: string, what: string) => {
    if (didWrite(outcome)) { toast.success(ok); return true }
    // ⚠️ didWrite, never `!error`. An RLS refusal returns zero rows and NO error, so checking
    // the error alone is how this codebase has repeatedly shown a success toast over a write
    // the database declined.
    const message = writeFailureMessage(outcome, what)
    if (message) toast.error(message.title, { description: message.description })
    return false
  }

  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try { return await fn() } finally { setBusy(false) }
  }

  const [sprintDialog, setSprintDialog] = useState<{ open: boolean; sprint: SprintRow | null }>({ open: false, sprint: null })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const saveSprint = (draft: SprintDraft) => run(async () => {
    if (!boardId) return
    const editing = sprintDialog.sprint
    const res = editing
      ? await updateSprint(supabase, editing.id, draft)
      : await createSprint(supabase, boardId, draft, userId || null)
    if (report(res.outcome, editing ? `${sprintNounTitle(term)} saved.` : `${sprintNounTitle(term)} created.`, `this ${sprintNoun(term)}`)) {
      setSprintDialog({ open: false, sprint: null })
      if (!editing && res.sprint) setSprintId(res.sprint.id)
      await refresh(boardId)
    }
  })

  const moveState = (next: 'active' | 'completed' | 'cancelled') => run(async () => {
    if (!sprint || !boardId) return
    const res = await setSprintState(supabase, sprint.id, next)
    const label = next === 'active' ? 'started' : next === 'completed' ? 'completed' : 'cancelled'
    if (report(res.outcome, `${sprint.title} ${label}.`, `this ${sprintNoun(term)}`)) {
      if (next !== 'active') {
        toast.info('Its numbers are now frozen. Later changes to these work items cannot alter them.')
      }
      await refresh(boardId)
    }
  })

  const removeSprint = () => run(async () => {
    if (!sprint || !boardId) return
    const res = await deleteSprint(supabase, sprint.id)
    if (report(res.outcome, `${sprint.title} deleted.`, `this ${sprintNoun(term)}`)) {
      setSprintId(null)
      await refresh(boardId)
    }
  })

  const addTasks = (taskIds: string[]) => run(async () => {
    if (!sprint || !boardId) return
    let failed = 0
    for (const id of taskIds) {
      const res = await addToSprint(supabase, sprint.id, id, userId || null)
      if (!didWrite(res.outcome)) failed++
    }
    // ⚠️ A batch with ANY refusal is never reported as a success. An RLS refusal returns zero
    // rows and no error, so a green toast over a half-applied batch is the easy failure here.
    if (failed === 0) toast.success(`${taskIds.length} item${taskIds.length === 1 ? '' : 's'} planned into ${sprint.title}.`)
    else toast.error(`${taskIds.length - failed} of ${taskIds.length} planned in. ${failed} could not be - you may not have permission to change ${failed === 1 ? 'it' : 'them'}.`)
    await refresh(boardId)
  })

  const removeTasks = (taskIds: string[]) => run(async () => {
    if (!sprint || !boardId) return
    let failed = 0
    for (const id of taskIds) {
      const res = await removeFromSprint(supabase, sprint.id, id)
      if (!didWrite(res.outcome)) failed++
    }
    if (failed === 0) toast.success(`Removed from ${sprint.title}. The work item itself is untouched.`)
    else toast.error(`${failed} item${failed === 1 ? '' : 's'} could not be removed.`)
    await refresh(boardId)
  })

  const moveToSprint = (taskId: string, toSprintId: string) => run(async () => {
    if (!sprint || !boardId) return
    const target = sprints.find((s) => s.id === toSprintId)
    const res = await moveBetweenSprints(supabase, sprint.id, toSprintId, taskId, userId || null)
    if (report(res.outcome, `Moved to ${target?.title ?? `the other ${sprintNoun(term)}`}.`, 'this move')) {
      await refresh(boardId)
    }
  })

  const reorder = (taskId: string, action: ReorderAction) => run(async () => {
    if (!boardId) return
    // ⚠️ Planned against every live task on the BOARD, not the filtered backlog on screen. A
    // column holds backlog and sprint work side by side; renumbering only the visible rows
    // would hand them positions that collide with the ones this panel does not show.
    const plan = planReorder(boardTasks, taskId, action, { listIsComplete: true })
    if (plan.blockedReason) { toast.error(plan.blockedReason); return }
    if (plan.updates.length === 0) return

    const res = await reorderBacklog(supabase, plan.updates)
    if (!didWrite(res.outcome)) {
      // Never a green toast over a half-renumbered column: a partial reorder leaves duplicate
      // positions that the board's own drag-and-drop then has to reconcile.
      const message = writeFailureMessage(res.outcome, 'order')
      toast.error(message?.title ?? 'That reorder did not save', {
        description: `${res.moved} of ${plan.updates.length} items moved. Reload before trying again.`,
      })
    }
    router.refresh()
    await refresh(boardId)
  })

  const [localTasks, setLocalTasks] = useState(tasks)
  useEffect(() => { setLocalTasks(tasks) }, [tasks])

  const estimate = (taskId: string, value: number | null) => run(async () => {
    const res = await setTaskEstimate(supabase, taskId, value)
    if (didWrite(res.outcome)) {
      setLocalTasks((prev) => prev.map((t: any) => (t.id === taskId ? { ...t, estimate_value: value } : t)))
      if (boardId) await refresh(boardId)
    } else {
      const message = writeFailureMessage(res.outcome, 'estimate')
      if (message) toast.error(message.title, { description: message.description })
    }
  })

  const quickCreate = (title: string) => run(async () => {
    if (!boardId) return
    const first = [...boardColumns].sort((a: any, b: any) => a.position - b.position)[0]
    if (!first) { toast.error('This board has no columns to create work in.'); return }
    const res = await supabase
      .from('tasks')
      .insert({ title, column_id: first.id, created_by: userId || null, position: 0, visibility: 'board' })
      .select('id')
    if (res.error || !res.data?.length) {
      toast.error(res.error?.message ?? 'That work item was not created.')
      return
    }
    toast.success('Work item created.')
    router.refresh()
  })

  const saveSettings = (patch: Partial<Omit<AgileSettings, 'board_id'>>) => run(async () => {
    if (!boardId) return
    const res = await saveAgileSettings(supabase, boardId, patch, userId || null)
    if (report(res.outcome, 'Settings saved.', 'these settings')) {
      if (res.settings) setSettings(res.settings)
      setSettingsOpen(false)
      router.refresh()
    }
  })

  /* ── Shell ─────────────────────────────────────────────────────────────────────── */

  const favoriteBoardHref = useCallback((id: string) => boardHref(role, id), [role])
  const { resolved: favoriteItems } = useFavorites(userId, { boardHref: favoriteBoardHref })

  const groups: SidebarNavGroup[] = useMemo(
    () => buildWorkspaceNav({
      role, modules,
      canUseMarketingCalendar: isAdmin || calendars.length > 0,
      canViewAudit: allows({ userId, platformRole: role }, 'audit.view'),
    }),
    [role, userId, modules, isAdmin, calendars.length],
  )
  const commands: Command[] = useMemo(() => buildCreateCommands({ role, modules }), [role, modules])

  const openTask = (taskId: string) => {
    if (!boardId) return
    // boardHref keys off the viewer's PLATFORM role: /dashboard/board/<id> passes
    // isAdmin={false} deliberately, so sending an admin there strips controls they hold.
    router.push(`${boardHref(role, boardId)}?task=${taskId}`)
  }

  // ⚠️ Whether migration 125 is applied. Passed down so no badge or dialog promises a refusal
  // the database will not make - see the WIP note in lib/agile.ts.
  const [wipEnforcementAvailable, setWipEnforcementAvailable] = useState(false)
  useEffect(() => {
    let live = true
    void supabase.rpc('wip_enforcement_installed').then(({ data, error }: any) => {
      if (!live) return
      setWipEnforcementAvailable(!error && data === true)
    })
    return () => { live = false }
  }, [supabase])

  const activeSettings = settings ?? (boardId ? normalizeAgileSettings(boardId, null) : null)
  const window_ = sprint ? sprintWindow(sprint, today) : null

  // Agile is on only when the MODULE is on and this board opted in - one function, so the two
  // halves of that rule cannot drift apart between the places that ask.
  const agileOn = agileActive(isModuleEnabled(modules, 'agile'), activeSettings)

  /**
   * ⚠️ Two different capabilities, and conflating them was a real defect.
   *
   * `canPlan` needs an OPEN window to plan into. `canManage` does not: quick-capturing a work
   * item, estimating one and changing priority order are all ordinary backlog work, and gating
   * them on a sprint existing meant a board that had just switched agile on presented a
   * completely inert backlog - no way to add anything, size anything or order anything until
   * somebody created a sprint they had nothing to put in yet.
   */
  const sprintIsOpen = Boolean(sprint) && sprint!.state !== 'completed' && sprint!.state !== 'cancelled'

  const backlogProps = {
    settings: activeSettings!,
    statuses, statusOptions: statuses, users, workItemTypes, density,
    backlog: backlog.map((t: any) => localTasks.find((l: any) => l.id === t.id) ?? t),
    sprint: sprint as any,
    sprintTasks: sprintTasks.map((t: any) => localTasks.find((l: any) => l.id === t.id) ?? t),
    allBoardTasks: boardTasks,
    // Only windows that can still accept work, and never the one already on screen.
    otherSprints: sprints.filter((s) => s.id !== sprint?.id && (s.state === 'planned' || s.state === 'active')) as any,
    canPlan: sprintIsOpen,
    canManage: agileOn,
    onOpenTask: openTask,
    onAdd: addTasks,
    onRemove: removeTasks,
    onMoveToSprint: moveToSprint,
    onReorder: reorder,
    onEstimate: estimate,
    onQuickCreate: quickCreate,
    busy: busy || loading,
  }

  return (
    <AppShell
      user={{ id: user?.id, role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="agile"
      breadcrumbs={[{ label: 'Agile' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<><ThemeControls /><HelpDialog /></>}
    >
      <div className="space-y-4 p-4 md:p-6">
        <header className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Agile</h1>
            <AgileInfoButton />
          </div>
          <p className="text-muted-foreground text-sm">
            Optional per board. A board that has it switched off is an ordinary board and never sees this vocabulary.
          </p>
        </header>

        {loadFailed && (
          <ErrorState
            title="Some work could not be loaded"
            description="The counts on this page are therefore incomplete. Reload before acting on them."
          />
        )}
        {loadError && (
          <ErrorState title={`${sprintNounPluralTitle(term)} could not be loaded`} description={loadError} />
        )}

        {boards.length === 0 ? (
          <EmptyState title="No boards you can see" description="Agile mode plans work that lives on a board." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={boardId ?? ''} onValueChange={chooseBoard}>
                <SelectTrigger id="agile-board-picker" className="w-[16rem]"><SelectValue placeholder="Pick a board" /></SelectTrigger>
                <SelectContent>
                  {boardOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.title}{b.agileEnabled ? '' : ' - agile off'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {sprints.length > 0 && (
                <Select value={sprint?.id ?? ''} onValueChange={setSprintId}>
                  <SelectTrigger id="agile-sprint-picker" className="w-[16rem]">
                    <SelectValue placeholder={`Pick a ${sprintNoun(term)}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {sprints.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title} - {SPRINT_STATE_LABELS[s.state]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={density} onValueChange={(v) => setDensity(v as any)}>
                <SelectTrigger id="agile-density" className="w-[9rem]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DENSITIES.map((d) => (
                    <SelectItem key={d} value={d}>{DENSITY_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="ml-auto flex gap-2">
                {activeSettings?.is_enabled && (
                  <Button size="sm" onClick={() => setSprintDialog({ open: true, sprint: null })} id="agile-new-sprint">
                    <Plus className="mr-1 h-4 w-4" /> New {sprintNoun(term)}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} id="agile-settings-button">
                  <Settings2 className="mr-1 h-4 w-4" /> Settings
                </Button>
              </div>
            </div>

            {!activeSettings?.is_enabled ? (
              <EmptyState
                title={`Agile is off for ${board?.title ?? 'this board'}`}
                description={
                  isAdmin
                    ? 'Switch it on in Settings to plan work in windows. Nothing about this board changes for anyone else until you do.'
                    : 'An admin can switch it on for this board. Until then it works as an ordinary board.'
                }
              />
            ) : (
              <>
                {sprint && (
                  <div className="bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{sprint.title}</p>
                      {sprint.goal && <p className="text-muted-foreground truncate text-xs">{sprint.goal}</p>}
                    </div>
                    <Badge variant={sprint.state === 'active' ? 'default' : 'outline'}>
                      {SPRINT_STATE_LABELS[sprint.state]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {sprint.start_date} to {sprint.end_date}
                      {window_ && sprint.state === 'active' && ` · day ${window_.elapsedDays} of ${window_.totalDays}`}
                    </span>

                    <div className="ml-auto flex flex-wrap gap-2">
                      {sprint.state === 'planned' && (
                        <Button
                          size="sm" disabled={busy || Boolean(startBlockedReason(sprint as any, sprints as any))}
                          title={startBlockedReason(sprint as any, sprints as any) ?? undefined}
                          onClick={() => moveState('active')}
                          id="agile-start-sprint"
                        >
                          <Play className="mr-1 h-3.5 w-3.5" /> Start
                        </Button>
                      )}
                      {sprint.state === 'active' && (
                        <Button size="sm" disabled={busy} onClick={() => moveState('completed')} id="agile-complete-sprint">
                          <Square className="mr-1 h-3.5 w-3.5" /> Complete
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setSprintDialog({ open: true, sprint })}>
                        Edit
                      </Button>
                      {sprint.state === 'planned' && (
                        <Button variant="ghost" size="sm" disabled={busy} onClick={removeSprint}>Delete</Button>
                      )}
                    </div>

                    {startBlockedReason(sprint as any, sprints as any) && sprint.state === 'planned' && (
                      <p className="text-muted-foreground w-full text-xs">
                        {startBlockedReason(sprint as any, sprints as any)}
                      </p>
                    )}
                  </div>
                )}

                <Tabs defaultValue="planning" className="space-y-4">
                  {/* ⚠️ The tab strip scrolls INSIDE ITS OWN container. Radix's TabsList is
                      `w-fit` and does not wrap, so four tabs measure 343px and pushed the whole
                      page sideways at a 320px viewport - caught by scripts/audit-mobile.mjs,
                      not by reading. Wide content scrolls in its own box; the page body never
                      does. The negative margin plus matching padding keeps the focus ring from
                      being clipped by the scroller. */}
                  <div className="-mx-1 overflow-x-auto px-1">
                    <TabsList>
                      <TabsTrigger value="planning" id="agile-tab-planning">Planning</TabsTrigger>
                      <TabsTrigger value="backlog" id="agile-tab-backlog">Backlog</TabsTrigger>
                      <TabsTrigger value="board" id="agile-tab-board">Taskboard</TabsTrigger>
                      <TabsTrigger value="metrics" id="agile-tab-metrics">Metrics</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="planning">
                    <BacklogPanel
                      mode="planning"
                      {...backlogProps}
                    />
                  </TabsContent>

                  <TabsContent value="backlog">
                    <BacklogPanel
                      mode="backlog"
                      {...backlogProps}
                    />
                  </TabsContent>

                  <TabsContent value="board">
                    <SprintTaskboard
                      settings={activeSettings} statuses={statuses} columns={boardColumns as any}
                      density={density} sprint={sprint as any}
                      sprintTasks={sprintTasks.map((t: any) => localTasks.find((l: any) => l.id === t.id) ?? t)}
                      boardTasks={boardTasks}
                      wipEnforcementAvailable={wipEnforcementAvailable}
                      swimlanes canManage={Boolean(sprint)}
                      onOpenTask={openTask} onEstimate={estimate}
                    />
                  </TabsContent>

                  <TabsContent value="metrics">
                    <SprintMetricsPanel
                      settings={activeSettings} statuses={statuses}
                      sprint={sprint as any} allSprints={sprints as any}
                      members={members} tasks={boardTasks}
                      snapshots={snapshots} samples={samples}
                      now={now} today={today}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </>
        )}
      </div>

      {activeSettings && board && (
        <>
          <SprintDialog
            open={sprintDialog.open}
            onOpenChange={(open) => setSprintDialog((s) => ({ ...s, open }))}
            term={term} unit={activeSettings.estimate_unit} users={users}
            sprint={sprintDialog.sprint} today={today} busy={busy} onSave={saveSprint}
          />
          <AgileSettingsDialog
            open={settingsOpen} onOpenChange={setSettingsOpen}
            boardTitle={board.title} settings={activeSettings}
            canManage={isAdmin} wipEnforcementAvailable={wipEnforcementAvailable}
            busy={busy} onSave={saveSettings}
          />
        </>
      )}
    </AppShell>
  )
}
