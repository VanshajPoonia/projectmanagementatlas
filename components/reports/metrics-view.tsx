'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock, CheckCircle2, XCircle, Timer, Users as UsersIcon } from 'lucide-react'
import { getAssigneeIds } from '@/lib/assignees'
import { getNormalizedTaskStatus } from '@/lib/task-status'
import {
  buildStatusEventMap,
  buildTaskJourney,
  findRecordedClose,
  getVerifiedStatusIntervals,
  summarizeActivityCoverage,
  type StatusEvent,
} from './metrics-activity'
import { Route } from 'lucide-react'

/**
 * Stable colour per status, so the same status is the same colour in every journey bar.
 * Indexed by the normalized key rather than the label, so renaming a status does not reshuffle
 * every chart. Falls back by hashing, so a status this list has never heard of still gets a
 * consistent colour rather than sharing one with its neighbour.
 */
const STAGE_COLORS: Record<string, string> = {
  to_do: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  review: 'bg-amber-500',
  blocked: 'bg-rose-500',
  done: 'bg-emerald-500',
  cancelled: 'bg-zinc-400',
}
const FALLBACK_COLORS = ['bg-violet-500', 'bg-teal-500', 'bg-orange-500', 'bg-cyan-500', 'bg-fuchsia-500']
function stageColor(key: string): string {
  if (STAGE_COLORS[key]) return STAGE_COLORS[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

interface MetricsViewProps {
  tasks: any[]
  users: any[]
  boards: any[]
}

function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '-'
  const days = ms / 86400000
  if (days >= 1) return `${days.toFixed(days >= 10 ? 0 : 1)}d`
  const hours = ms / 3600000
  if (hours >= 1) return `${hours.toFixed(1)}h`
  return `${Math.max(1, Math.round(ms / 60000))}m`
}

function median(nums: number[]): number {
  if (!nums.length) return NaN
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export default function MetricsView({ tasks, users, boards }: MetricsViewProps) {
  const supabase = createClient()
  const [activityByTask, setActivityByTask] = useState<Record<string, StatusEvent[]>>({})
  const [activityError, setActivityError] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase
      .from('task_activity')
      // Select every activity shape so deployments can read structured events when the
      // new fields exist while retaining compatibility with legacy action-only rows.
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data, error }: { data: any[] | null; error: unknown }) => {
        if (!active) return
        setActivityByTask(buildStatusEventMap(data || []))
        setActivityError(Boolean(error))
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const boardTitleById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of boards) m[b.id] = b.title
    return m
  }, [boards])

  const visibleActivityByTask = useMemo(() => {
    const visible: Record<string, StatusEvent[]> = {}
    for (const task of tasks) {
      if (activityByTask[task.id]) visible[task.id] = activityByTask[task.id]
    }
    return visible
  }, [tasks, activityByTask])

  // Per-task derived metrics: close time comes only from an explicit status transition.
  // updated_at can mean any edit, so it is deliberately never used as a closure timestamp.
  const taskMetrics = useMemo(() => {
    return tasks.map((task) => {
      const created = task.created_at ? new Date(task.created_at).getTime() : NaN
      const events = visibleActivityByTask[task.id] || []
      const bucket = getNormalizedTaskStatus(task)
      const skey = (task.column?.status_key || '').toLowerCase()
      const rawStatus = String(task.status || '').toLowerCase()
      const columnTitle = String(task.column?.title || '').toLowerCase()
      const cancelled = bucket === 'done' && (
        skey ? skey.includes('cancel') : rawStatus.includes('cancel') || columnTitle.includes('cancel')
      )
      const closedAt = bucket === 'done'
        ? findRecordedClose(events, cancelled ? 'cancelled' : 'completed')
        : null
      const cycleMs = bucket === 'done' && closedAt !== null && isFinite(created) ? closedAt - created : null
      return { task, created, events, bucket, cancelled, closedAt, cycleMs }
    })
  }, [tasks, visibleActivityByTask])

  const completedTasks = taskMetrics.filter((t) => t.bucket === 'done' && !t.cancelled)
  const completed = completedTasks.filter((t) => t.cycleMs !== null && (t.cycleMs as number) >= 0)
  const cancelledTasks = taskMetrics.filter((t) => t.cancelled)
  const cycleValues = completed.map((t) => t.cycleMs as number)
  const avgCycle = cycleValues.length ? cycleValues.reduce((a, b) => a + b, 0) / cycleValues.length : NaN
  const medCycle = median(cycleValues)
  const verifiedIntervals = useMemo(
    () => getVerifiedStatusIntervals(visibleActivityByTask),
    [visibleActivityByTask],
  )

  // Average time in a status uses only matching entry/exit event pairs.
  const timeInStatus = useMemo(() => {
    const agg: Record<string, { total: number; count: number; label: string }> = {}
    for (const interval of verifiedIntervals) {
      agg[interval.key] ||= { total: 0, count: 0, label: interval.label }
      agg[interval.key].total += interval.durationMs
      agg[interval.key].count += 1
    }
    return Object.entries(agg)
      .map(([key, { total, count, label }]) => ({
        key,
        label,
        avg: total / count,
        count,
      }))
      .sort((a, b) => b.avg - a.avg)
  }, [verifiedIntervals])

  const coverage = useMemo(
    () => summarizeActivityCoverage({
      taskIds: taskMetrics.map(({ task }) => task.id),
      completedTaskIds: completedTasks.map(({ task }) => task.id),
      activityByTask: visibleActivityByTask,
      intervals: verifiedIntervals,
    }),
    [taskMetrics, completedTasks, visibleActivityByTask, verifiedIntervals],
  )

  const personnel = useMemo(() => {
    return users
      .map((u) => {
        const mine = taskMetrics.filter((t) => getAssigneeIds(t.task).includes(u.id))
        const open = mine.filter((t) => t.bucket !== 'done').length
        const done = mine.filter((t) => t.bucket === 'done' && !t.cancelled)
        const cycles = done.map((t) => t.cycleMs).filter((v): v is number => v !== null && v >= 0)
        const avg = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : NaN
        return { user: u, open, completed: done.length, avgCycle: avg, total: mine.length }
      })
      .filter((p) => p.total > 0)
      .sort((a, b) => b.completed - a.completed || b.open - a.open)
  }, [taskMetrics, users])

  const recentCompleted = [...completed].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0)).slice(0, 12)

  /**
   * Bobby asked for "entry date to progression on each status to close". The card above answers
   * the averaged half of that; this answers the per-task half - where one specific piece of work
   * actually sat on its way through, in order, with the dates.
   *
   * Built only for tasks that have both a creation time and enough recorded history to say
   * something, because a bar with one undifferentiated block asserts a journey nobody measured.
   */
  const journeys = useMemo(() => {
    return recentCompleted
      .map(({ task, created, closedAt }) => {
        const stages = buildTaskJourney(visibleActivityByTask[task.id] || [], created, closedAt)
        const measured = stages.filter((stage) => stage.durationMs > 0)
        const total = measured.reduce((sum, stage) => sum + stage.durationMs, 0)
        return { task, stages: measured, total }
      })
      .filter((row) => row.stages.length >= 2 && row.total > 0)
      .slice(0, 8)
  }, [recentCompleted, visibleActivityByTask])
  const maxStatusAvg = timeInStatus.length ? Math.max(...timeInStatus.map((s) => s.avg)) : 0

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Computing metrics…</div>
  }

  const stat = (icon: React.ReactNode, label: string, value: string, sub: string) => (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</div>
        <div className="min-w-0">
          <div className="text-xl font-semibold leading-tight">{value}</div>
          <div className="truncate text-xs text-muted-foreground">{label} · {sub}</div>
        </div>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      {/* Two across on a phone; see task-overview.tsx for why. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stat(<Timer className="h-4 w-4" />, 'Avg entry → close', fmtDuration(avgCycle), `${completed.length} of ${completedTasks.length} completed`)}
        {stat(<Clock className="h-4 w-4" />, 'Median entry → close', fmtDuration(medCycle), 'recorded closes only')}
        {stat(<CheckCircle2 className="h-4 w-4" />, 'Completed', String(completedTasks.length), `${completed.length} with timing data`)}
        {stat(<XCircle className="h-4 w-4" />, 'Cancelled', String(cancelledTasks.length), 'archived, not done')}
      </div>

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" /> Timing data coverage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {activityError ? (
            <p className="text-destructive">Activity history could not be loaded. Timing metrics are unavailable until it can be read.</p>
          ) : (
            <>
              <p>
                Recorded close events cover <span className="font-medium text-foreground">{coverage.completedWithRecordedClose} of {coverage.completedTasks}</span> completed tasks.
                {' '}Status history exists for <span className="font-medium text-foreground">{coverage.tasksWithStatusHistory} of {coverage.totalTasks}</span> tasks.
              </p>
              <p>
                Time-in-status uses <span className="font-medium text-foreground">{coverage.verifiedIntervals}</span> verified interval{coverage.verifiedIntervals === 1 ? '' : 's'} across {coverage.tasksWithVerifiedIntervals} task{coverage.tasksWithVerifiedIntervals === 1 ? '' : 's'}.
                {' '}{coverage.structuredEvents} structured and {coverage.legacyEvents} legacy status event{coverage.structuredEvents + coverage.legacyEvents === 1 ? '' : 's'} were read.
              </p>
              <p>Tasks without matching activity are excluded; ordinary edits are never treated as close events.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Timer className="h-4 w-4" /> Average time in each status</CardTitle>
        </CardHeader>
        <CardContent>
          {timeInStatus.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Not enough status-change history yet. This fills in as tasks move between statuses.</p>
          ) : (
            <div className="space-y-3">
              {timeInStatus.map((s) => (
                <div key={s.key} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{s.label}</span>
                    <span className="text-muted-foreground">{fmtDuration(s.avg)} avg · {s.count} move{s.count === 1 ? '' : 's'}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${maxStatusAvg > 0 ? (s.avg / maxStatusAvg) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><UsersIcon className="h-4 w-4" /> Personnel</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {personnel.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No assigned tasks yet.</p>
          ) : (
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Open</th>
                  <th className="px-4 py-2 font-medium">Completed</th>
                  <th className="py-2 pl-4 font-medium">Avg entry → close</th>
                </tr>
              </thead>
              <tbody>
                {personnel.map((p) => (
                  <tr key={p.user.id} className="border-b last:border-0">
                    <td className="py-2 pr-4">{p.user.full_name || p.user.email}</td>
                    <td className="px-4 py-2">{p.open}</td>
                    <td className="px-4 py-2">{p.completed}</td>
                    <td className="py-2 pl-4">{fmtDuration(p.avgCycle)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4" /> Where the time went, task by task
          </CardTitle>
        </CardHeader>
        <CardContent>
          {journeys.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No task yet has enough recorded status history to break its cycle down by stage.
              This fills in as work moves between statuses.
            </p>
          ) : (
            <div className="space-y-4">
              {journeys.map(({ task, stages, total }) => (
                <div key={task.id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDuration(total)} total</span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
                    {stages.map((stage, index) => (
                      <div
                        key={`${stage.key}-${index}`}
                        className={stageColor(stage.key)}
                        style={{ width: `${(stage.durationMs / total) * 100}%` }}
                        title={`${stage.label}: ${fmtDuration(stage.durationMs)}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {stages.map((stage, index) => (
                      <span key={`${stage.key}-legend-${index}`} className="inline-flex items-center gap-1">
                        <span className={`h-2 w-2 rounded-full ${stageColor(stage.key)}`} aria-hidden="true" />
                        {stage.label} · {fmtDuration(stage.durationMs)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Recently completed: entry to close</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {recentCompleted.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No completed tasks with a measurable cycle yet.</p>
          ) : (
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Board</th>
                  <th className="px-4 py-2 font-medium">Entered</th>
                  <th className="px-4 py-2 font-medium">Closed</th>
                  <th className="py-2 pl-4 font-medium">Cycle</th>
                </tr>
              </thead>
              <tbody>
                {recentCompleted.map(({ task, created, closedAt, cycleMs }) => (
                  <tr key={task.id} className="border-b last:border-0">
                    <td className="max-w-[16rem] truncate py-2 pr-4">{task.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">{boardTitleById[task.board_id] || boardTitleById[task.column?.board_id] || '-'}</td>
                    <td className="px-4 py-2">{isFinite(created) ? new Date(created).toLocaleDateString('en-US') : '-'}</td>
                    <td className="px-4 py-2">{closedAt ? new Date(closedAt).toLocaleDateString('en-US') : '-'}</td>
                    <td className="py-2 pl-4 font-medium">{fmtDuration(cycleMs as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
