'use client'

/**
 * The bar that appears when tasks are selected, and the dialog that runs the change.
 *
 * The whole design follows from one fact about this codebase: an RLS refusal returns zero rows
 * and no error (lib/rls-write.ts). So a bulk bar that fires N updates and shows a green toast
 * is a bar that will one day tell someone they reassigned forty tasks while changing none.
 *
 * Everything here therefore routes through lib/bulk-operations.ts, which:
 *   - works out what would change BEFORE anything runs, so the count in the confirmation is
 *     the count that then happens, and an already-matching task is never counted as a change;
 *   - classifies each item individually as changed / unchanged / refused / errored;
 *   - never reports a run with refusals or errors as a success;
 *   - hands back a CSV of exactly what happened, which is the only useful artefact when a
 *     forty-item batch half-works.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  X, Users, UserMinus, Flag, Tag, Tags as TagIcon, CalendarDays, Archive, Trash2,
  MoveRight, FolderInput, Loader2, AlertTriangle, Download, RefreshCw,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite } from '@/lib/rls-write'
import { allows, type Actor } from '@/lib/capabilities'
import { getAssigneeIds } from '@/lib/assignees'
import { TASK_PRIORITIES } from '@/components/shell/commands'
import {
  planBulkOperation,
  runBulkOperation,
  summarizeRun,
  bulkReportCsv,
  retryPlanFrom,
  mergeRunReports,
  OPERATION_LABELS,
  ALL_OPERATIONS,
  type BulkOperationKind,
  type BulkOperationInput,
  type BulkTask,
  type ApplyResult,
  type BulkRunReport,
} from '@/lib/bulk-operations'

interface BulkActionBarProps {
  selectedIds: string[]
  tasks: any[]
  users: any[]
  tags: any[]
  columns: any[]
  /** The board these tasks are on, so the Move picker can exclude it. */
  currentBoardId: string
  actor: Actor
  onClear: () => void
  onDone: () => void
}

/**
 * Which operations the bar offers, in the order they are most often wanted.
 *
 * ⚠️ This must stay exhaustive over BulkOperationKind. `unassign`, `unlabel` and `move` were
 * implemented in lib/bulk-operations.ts and left out of this list, which is this repo's
 * most-repeated defect in miniature: working code behind no route a human can take. There is a
 * test asserting the two lists agree, so adding a kind to the engine and forgetting the bar
 * now fails rather than shipping dead code.
 */
const DISPLAY_ORDER: readonly BulkOperationKind[] = [
  'assign', 'unassign', 'priority', 'status', 'label', 'unlabel',
  'due_date', 'shift_dates', 'move', 'archive', 'delete',
]

/**
 * Derived from ALL_OPERATIONS rather than restated, so a kind added to the engine cannot be
 * silently missing here - the worst it can do is appear at the end in the wrong position,
 * which is visible. Listing them again by hand is exactly how `unassign`, `unlabel` and `move`
 * ended up implemented and unreachable.
 */
const OFFERED: readonly BulkOperationKind[] = [
  ...DISPLAY_ORDER.filter((k) => ALL_OPERATIONS.includes(k)),
  ...ALL_OPERATIONS.filter((k) => !DISPLAY_ORDER.includes(k)),
]

const OPERATION_ICONS: Record<BulkOperationKind, typeof Users> = {
  assign: Users, unassign: UserMinus, priority: Flag, status: MoveRight,
  label: Tag, unlabel: TagIcon, due_date: CalendarDays, shift_dates: CalendarDays,
  move: FolderInput, archive: Archive, delete: Trash2,
}

export default function BulkActionBar({
  selectedIds, tasks, users, tags, columns, currentBoardId, actor, onClear, onDone,
}: BulkActionBarProps) {
  const [kind, setKind] = useState<BulkOperationKind | null>(null)
  const [targetId, setTargetId] = useState('')
  const [priority, setPriority] = useState('3')
  const [dueDate, setDueDate] = useState('')
  const [shiftDays, setShiftDays] = useState('7')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<BulkRunReport | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [boardColumns, setBoardColumns] = useState<any[]>([])
  const supabase = createClient()

  // Destination columns for Move, fetched only when Move is actually chosen. RLS filters this
  // to boards the mover can see; migration 102's RPC is still the authority on whether the
  // write lands, so an unreadable board simply never appears rather than failing on apply.
  useEffect(() => {
    if (kind !== 'move' || boardColumns.length > 0) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('columns')
        .select('id, title, position, board_id, board:boards(id, title, archived_at)')
        .order('position')
      if (cancelled) return
      setBoardColumns(
        (data ?? [])
          .filter((c: any) => c.board && !c.board.archived_at && c.board_id !== currentBoardId)
          .map((c: any) => ({ ...c, boardTitle: c.board.title })),
      )
    })()
    return () => { cancelled = true }
  }, [kind, boardColumns.length, supabase, currentBoardId])

  const selected: BulkTask[] = useMemo(() => {
    const byId = new Map(tasks.map((t: any) => [t.id, t]))
    return selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        due_date: t.due_date,
        status: t.status,
        column_id: t.column_id,
        archived_at: t.archived_at,
        assigneeIds: getAssigneeIds(t),
        tagIds: (t.task_tags ?? []).map((tt: any) => tt.tag_id ?? tt.tag?.id).filter(Boolean),
      }))
  }, [selectedIds, tasks])

  const input: BulkOperationInput | null = useMemo(() => {
    if (!kind) return null
    switch (kind) {
      case 'assign':
      case 'unassign':
        return { kind, targetId, targetLabel: users.find((u: any) => u.id === targetId)?.full_name ?? 'them' }
      case 'priority':
        return { kind, priority: Number(priority), targetLabel: TASK_PRIORITIES.find((p) => p.value === Number(priority))?.label }
      case 'status': {
        const col = columns.find((c: any) => c.id === targetId)
        return { kind, columnId: targetId, targetLabel: col?.title }
      }
      case 'label':
      case 'unlabel':
        return { kind, targetId, targetLabel: tags.find((t: any) => t.id === targetId)?.name }
      case 'move': {
        const col = boardColumns.find((c: any) => c.id === targetId)
        return { kind, columnId: targetId, boardId: col?.board_id, targetLabel: col ? `${col.boardTitle} - ${col.title}` : undefined }
      }
      case 'due_date':
        return { kind, dueDate: dueDate || null }
      case 'shift_dates':
        return { kind, shiftDays: Number(shiftDays) || 0 }
      default:
        return { kind }
    }
  }, [kind, targetId, priority, dueDate, shiftDays, users, columns, tags, boardColumns])

  const plan = useMemo(() => {
    if (!input) return null
    return planBulkOperation(input, selected, (task, k) => {
      // The same capability vocabulary the card and the modal use, so the bar can never be
      // more permissive than the controls it replaces.
      const subject = { created_by: (task as any).created_by, assigned_to: (task as any).assigned_to, assigneeIds: task.assigneeIds }
      const raw = tasks.find((t: any) => t.id === task.id)
      const full = { created_by: raw?.created_by, assigned_to: raw?.assigned_to, assigneeIds: task.assigneeIds }
      if (k === 'due_date' || k === 'shift_dates') {
        // Due dates are narrower than edit in this product - creator or admin only (038).
        return allows(actor, 'task.schedule', full)
          ? { allowed: true, presentation: 'allow' }
          : { allowed: false, presentation: 'explain', reason: 'Only the task’s creator or an admin can change its due date.' }
      }
      if (k === 'delete') {
        return allows(actor, 'task.delete', full)
          ? { allowed: true, presentation: 'allow' }
          : { allowed: false, presentation: 'explain', reason: 'You cannot delete this task.' }
      }
      return allows(actor, 'task.edit', full)
        ? { allowed: true, presentation: 'allow' }
        : { allowed: false, presentation: 'explain', reason: 'You cannot change this task.' }
    })
  }, [input, selected, actor, tasks])

  /** One item's write. Returns the vocabulary runBulkOperation understands. */
  async function applyOne(taskId: string): Promise<ApplyResult> {
    if (!input) return { kind: 'error', message: 'No operation selected', retryable: false }
    const task = selected.find((t) => t.id === taskId)

    try {
      switch (input.kind) {
        case 'assign': {
          const res = await supabase.from('task_assignees')
            .insert({ task_id: taskId, user_id: input.targetId }).select()
          if (res.error) {
            // Already assigned is not a failure; the plan filters these out, but a race
            // between planning and running can still land here.
            if (res.error.code === '23505') return { kind: 'ok' }
            return { kind: 'error', message: res.error.message, retryable: true }
          }
          return (res.data?.length ?? 0) > 0 ? { kind: 'ok' } : { kind: 'refused' }
        }
        case 'unassign': {
          const res = await supabase.from('task_assignees').delete()
            .eq('task_id', taskId).eq('user_id', input.targetId).select()
          if (res.error) return { kind: 'error', message: res.error.message, retryable: true }
          return (res.data?.length ?? 0) > 0 ? { kind: 'ok' } : { kind: 'refused' }
        }
        case 'label': {
          const res = await supabase.from('task_tags')
            .insert({ task_id: taskId, tag_id: input.targetId }).select()
          if (res.error) {
            if (res.error.code === '23505') return { kind: 'ok' }
            return { kind: 'error', message: res.error.message, retryable: true }
          }
          return (res.data?.length ?? 0) > 0 ? { kind: 'ok' } : { kind: 'refused' }
        }
        case 'unlabel': {
          const res = await supabase.from('task_tags').delete()
            .eq('task_id', taskId).eq('tag_id', input.targetId).select()
          if (res.error) return { kind: 'error', message: res.error.message, retryable: true }
          return (res.data?.length ?? 0) > 0 ? { kind: 'ok' } : { kind: 'refused' }
        }
        case 'move': {
          // The RPC from migration 102, never a bare UPDATE: a refused UPDATE reports zero
          // rows rather than an error, and a parent must move in the same transaction as its
          // subtasks. Same call move-task-dialog.tsx makes, deliberately - a second, thinner
          // path to moving a task between boards is how the two end up disagreeing.
          const res = await supabase.rpc('move_task_to_board', {
            p_task_id: taskId, p_column_id: input.columnId,
          })
          if (res.error) return { kind: 'error', message: res.error.message, retryable: false }
          return res.data ? { kind: 'ok' } : { kind: 'refused' }
        }
        case 'priority': {
          const res = await supabase.from('tasks').update({ priority: input.priority }).eq('id', taskId).select()
          return toApply(await classifyWrite(res as any))
        }
        case 'status': {
          const col = columns.find((c: any) => c.id === input.columnId)
          const res = await supabase.from('tasks')
            .update({ column_id: input.columnId, status: col?.status_key ?? undefined })
            .eq('id', taskId).select()
          return toApply(await classifyWrite(res as any))
        }
        case 'due_date': {
          const res = await supabase.from('tasks').update({ due_date: input.dueDate }).eq('id', taskId).select()
          return toApply(await classifyWrite(res as any))
        }
        case 'shift_dates': {
          if (!task?.due_date) return { kind: 'ok' }
          // ⚠️ `setUTCDate`/`getUTCDate` are load-bearing, not incidental. `due_date` is a
          // TIMESTAMPTZ storing MIDNIGHT on the chosen day, so shifting in UTC moves the stored
          // day by exactly N and preserves that midnight. The LOCAL equivalents would drift the
          // time of day across a DST boundary and, west of Greenwich, shift the wrong day.
          const dt = new Date(task.due_date)
          dt.setUTCDate(dt.getUTCDate() + (input.shiftDays ?? 0))
          const res = await supabase.from('tasks').update({ due_date: dt.toISOString() }).eq('id', taskId).select()
          return toApply(await classifyWrite(res as any))
        }
        case 'archive': {
          const { data: { user } } = await supabase.auth.getUser()
          const res = await supabase.from('tasks')
            .update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null })
            .eq('id', taskId).select()
          // Archiving takes the row out of the default view, so a zero-row result is genuinely
          // ambiguous here. classifyWrite's probe is what tells "refused" from "saved and gone".
          return toApply(await classifyWrite(res as any, {
            stillReadable: async () => {
              const { data } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle()
              return Boolean(data)
            },
          }))
        }
        case 'delete': {
          const { data: { user } } = await supabase.auth.getUser()
          const res = await supabase.from('tasks')
            .update({ deleted_at: new Date().toISOString(), deleted_by: user?.id ?? null })
            .eq('id', taskId).select()
          return toApply(await classifyWrite(res as any, {
            stillReadable: async () => {
              const { data } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle()
              return Boolean(data)
            },
          }))
        }
        default:
          return { kind: 'error', message: 'Unsupported operation', retryable: false }
      }
    } catch (err: any) {
      return { kind: 'error', message: err?.message ?? 'Unexpected failure', retryable: true }
    }
  }

  async function handleRun() {
    if (!plan || plan.isNoOp) return
    setRunning(true)
    setProgress({ done: 0, total: plan.items.length })
    try {
      const result = await runBulkOperation(plan, applyOne, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const summary = summarizeRun(result)
      const show = summary.tone === 'error' ? toast.error : summary.tone === 'warning' ? toast.warning : toast.success
      show(summary.title, { description: summary.description, duration: summary.tone === 'success' ? 4000 : 10000 })

      // Keep the report on screen when anything did not go through, so the CSV is reachable.
      if (result.counts.error > 0 || result.counts.refused > 0) {
        setReport(result)
      } else {
        setKind(null)
        onClear()
      }
      onDone()
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  /**
   * Try the transient failures again, and only those.
   *
   * runBulkOperation already retried each item up to three times inside the run, so reaching
   * here means a failure outlasted that - a dropped connection, a server restart mid-batch.
   * The engine has always exposed `retryableIds` for exactly this and nothing consumed it.
   *
   * Items that already changed are not in that set, so this cannot double-apply, and refusals
   * are not in it either, so it cannot re-ask a question the policy already answered.
   */
  async function handleRetry() {
    if (!plan || !report || report.retryableIds.length === 0) return
    const again = retryPlanFrom(plan, report)
    if (again.isNoOp) return
    setRetrying(true)
    setProgress({ done: 0, total: again.items.length })
    try {
      const result = await runBulkOperation(again, applyOne, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      const merged = mergeRunReports(report, result)
      const summary = summarizeRun(merged)
      const show = summary.tone === 'error' ? toast.error : summary.tone === 'warning' ? toast.warning : toast.success
      show(summary.title, { description: summary.description, duration: summary.tone === 'success' ? 4000 : 10000 })

      if (merged.counts.error > 0 || merged.counts.refused > 0) {
        setReport(merged)
      } else {
        setReport(null)
        setKind(null)
        onClear()
      }
      onDone()
    } finally {
      setRetrying(false)
      setProgress(null)
    }
  }

  function downloadReport() {
    if (!report) return
    const blob = new Blob([bulkReportCsv(report)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bulk-${report.kind}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (selectedIds.length === 0) return null

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-4 z-40 mx-auto flex w-fit max-w-[95vw] items-center gap-2 rounded-full border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
        data-testid="bulk-action-bar"
        role="toolbar"
        aria-label={`${selectedIds.length} tasks selected`}
      >
        <Badge variant="secondary" className="shrink-0" data-testid="bulk-count">
          {selectedIds.length} selected
        </Badge>
        <div className="flex items-center gap-1 overflow-x-auto">
          {OFFERED.map((k) => {
            const Icon = OPERATION_ICONS[k] ?? Flag
            return (
              <Button
                key={k}
                variant={k === 'delete' ? 'ghost' : 'ghost'}
                size="sm"
                className={k === 'delete' ? 'shrink-0 text-destructive' : 'shrink-0'}
                onClick={() => { setKind(k); setReport(null) }}
              >
                <Icon className="mr-1 h-3.5 w-3.5" />
                {OPERATION_LABELS[k]}
              </Button>
            )
          })}
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} aria-label="Clear selection" className="shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={kind !== null} onOpenChange={(open) => { if (!open && !running) { setKind(null); setReport(null) } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{kind ? OPERATION_LABELS[kind] : ''}</DialogTitle>
            <DialogDescription>
              {selectedIds.length} {selectedIds.length === 1 ? 'task is' : 'tasks are'} selected.
            </DialogDescription>
          </DialogHeader>

          {report ? (
            <div className="space-y-3">
              <Alert variant={report.counts.error > 0 ? 'destructive' : 'default'}>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {report.counts.changed} changed, {report.counts.unchanged} already matched,{' '}
                  {report.counts.refused} not permitted, {report.counts.error} failed.
                </AlertDescription>
              </Alert>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {report.items.filter((i) => i.status === 'refused' || i.status === 'error').map((i) => (
                  <div key={i.taskId} className="flex items-start gap-2">
                    <Badge variant="outline" className="shrink-0 text-[10px]">{i.status}</Badge>
                    <span className="truncate">{i.title}</span>
                    {/* Attempts are only worth showing when there was more than one - otherwise
                        the column is a wall of "1" that says nothing. >1 is the signal that the
                        run retried and still could not get it through. */}
                    {i.attempts > 1 && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]" title="Times this task was tried">
                        {i.attempts}&times;
                      </Badge>
                    )}
                    {i.message && <span className="truncate text-xs text-muted-foreground">{i.message}</span>}
                  </div>
                ))}
              </div>
              {report.counts.refused > 0 && report.retryableIds.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing here is worth retrying - a refusal is a permission answer, not a glitch.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={downloadReport}>
                  <Download className="mr-1 h-3.5 w-3.5" /> Download report
                </Button>
                {report.retryableIds.length > 0 && (
                  <Button
                    id="bulk-retry"
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    disabled={retrying}
                  >
                    <RefreshCw className={`mr-1 h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                    {retrying
                      ? `Retrying${progress ? ` ${progress.done}/${progress.total}` : ''}...`
                      : `Retry ${report.retryableIds.length} failed`}
                  </Button>
                )}
                <Button size="sm" onClick={() => { setReport(null); setKind(null); onClear() }}>Done</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {(kind === 'assign' || kind === 'unassign') && (
                <Field label="Person">
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id="bulk-assign"><SelectValue placeholder="Pick someone" /></SelectTrigger>
                    <SelectContent>
                      {users.map((u: any) => (
                        <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {kind === 'priority' && (
                <Field label="Priority">
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger id="bulk-priority"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p.value} value={String(p.value)}>{p.value} - {p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {kind === 'status' && (
                <Field label="Column">
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id="bulk-column"><SelectValue placeholder="Pick a column" /></SelectTrigger>
                    <SelectContent>
                      {columns.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {(kind === 'label' || kind === 'unlabel') && (
                <Field label="Label">
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id="bulk-label"><SelectValue placeholder="Pick a label" /></SelectTrigger>
                    <SelectContent>
                      {tags.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {kind === 'move' && (
                <Field label="Destination">
                  <Select value={targetId} onValueChange={setTargetId}>
                    <SelectTrigger id="bulk-move"><SelectValue placeholder="Pick a board and column" /></SelectTrigger>
                    <SelectContent>
                      {boardColumns.map((c: any) => (
                        <SelectItem key={c.id} value={c.id}>{c.boardTitle} - {c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Subtasks move with their parent, in the same transaction.
                  </p>
                </Field>
              )}

              {kind === 'due_date' && (
                <Field label="Due date">
                  <Input id="bulk-due-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Leave empty to clear the due date.</p>
                </Field>
              )}

              {kind === 'shift_dates' && (
                <Field label="Move by (days)">
                  <Input id="bulk-shift-days" type="number" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Negative moves them earlier. Tasks with no due date are left alone.
                  </p>
                </Field>
              )}

              {/* The count that matters. "40 selected" is not what will happen; this is. */}
              {plan && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm" data-testid="bulk-plan">
                  <p>
                    <strong data-testid="bulk-will-change">{plan.counts.willChange}</strong>{' '}
                    of {plan.counts.total} will change.
                  </p>
                  {plan.counts.alreadyMatches > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {plan.counts.alreadyMatches} already {plan.counts.alreadyMatches === 1 ? 'matches' : 'match'} and will be left alone.
                    </p>
                  )}
                  {plan.counts.notPermitted > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="bulk-not-permitted">
                      {plan.counts.notPermitted} cannot be changed by you and will be skipped.
                    </p>
                  )}
                </div>
              )}

              {plan?.confirmation && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription data-testid="bulk-confirmation">{plan.confirmation}</AlertDescription>
                </Alert>
              )}

              {plan?.destructive && plan.counts.willChange > 0 && (
                <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-2 text-sm">
                  {plan.items.filter((i) => i.outcome === 'will_change').map((i) => (
                    <div key={i.taskId} className="truncate">{i.title}</div>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setKind(null)} disabled={running}>Cancel</Button>
                <Button
                  onClick={handleRun}
                  disabled={running || !plan || plan.isNoOp}
                  variant={plan?.destructive ? 'destructive' : 'default'}
                >
                  {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {progress
                    ? `${progress.done} of ${progress.total}...`
                    : plan?.isNoOp
                      ? 'Nothing to change'
                      : `Apply to ${plan?.counts.willChange ?? 0}`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>
}

/** Translate lib/rls-write.ts's vocabulary into the one runBulkOperation speaks. */
function toApply(outcome: { kind: string; message?: string }): ApplyResult {
  switch (outcome.kind) {
    case 'ok': return { kind: 'ok' }
    case 'invisible': return { kind: 'invisible' }
    case 'refused': return { kind: 'refused' }
    default: return { kind: 'error', message: outcome.message ?? 'Failed', retryable: true }
  }
}
