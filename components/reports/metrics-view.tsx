'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock, CheckCircle2, XCircle, Timer, Users as UsersIcon } from 'lucide-react'
import { getAssigneeIds } from '@/lib/assignees'
import { getNormalizedTaskStatus } from '@/lib/task-status'

interface MetricsViewProps {
  tasks: any[]
  users: any[]
  boards: any[]
}

// task_activity logs status changes as: changed status from "<old>" to "<new>" (display labels).
const STATUS_RE = /changed status from "(.+?)" to "(.+?)"/

// Local mirror of lib/task-status's bucketFromText (not exported) — classify a status *label*.
function bucketOf(label: string): 'to_do' | 'in_progress' | 'done' {
  const v = (label || '').toLowerCase()
  if (v.includes('done') || v.includes('complete') || v.includes('cancel')) return 'done'
  if (v.includes('progress') || v.includes('going') || v.includes('ongoing')) return 'in_progress'
  return 'to_do'
}

function fmtDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—'
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

type StatusEvent = { from: string; to: string; at: number }

export default function MetricsView({ tasks, users, boards }: MetricsViewProps) {
  const supabase = createClient()
  const [activityByTask, setActivityByTask] = useState<Record<string, StatusEvent[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase
      .from('task_activity')
      .select('task_id, action, created_at')
      .ilike('action', 'changed status%')
      .order('created_at', { ascending: true })
      .then(({ data }: { data: any[] | null }) => {
        if (!active) return
        const map: Record<string, StatusEvent[]> = {}
        for (const row of data || []) {
          const m = STATUS_RE.exec(row.action || '')
          if (!m) continue
          ;(map[row.task_id] ||= []).push({ from: m[1], to: m[2], at: new Date(row.created_at).getTime() })
        }
        setActivityByTask(map)
        setLoading(false)
      })
    return () => { active = false }
  }, [])

  const boardTitleById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const b of boards) m[b.id] = b.title
    return m
  }, [boards])

  // Per-task derived metrics: bucket, cancelled-ness, close time, cycle time (entry → close).
  const taskMetrics = useMemo(() => {
    return tasks.map((task) => {
      const created = task.created_at ? new Date(task.created_at).getTime() : NaN
      const events = activityByTask[task.id] || []
      const bucket = getNormalizedTaskStatus(task)
      const skey = (task.column?.status_key || '').toLowerCase()
      const cancelled = bucket === 'done' && skey.includes('cancel')
      // Close time = the last transition INTO a done-bucket status; fall back to updated_at.
      let closedAt: number | null = null
      for (let i = events.length - 1; i >= 0; i--) {
        if (bucketOf(events[i].to) === 'done') { closedAt = events[i].at; break }
      }
      if (closedAt === null && bucket === 'done' && task.updated_at) closedAt = new Date(task.updated_at).getTime()
      const cycleMs = bucket === 'done' && closedAt !== null && isFinite(created) ? closedAt - created : null
      return { task, created, events, bucket, cancelled, closedAt, cycleMs }
    })
  }, [tasks, activityByTask])

  const completed = taskMetrics.filter((t) => t.bucket === 'done' && !t.cancelled && t.cycleMs !== null && (t.cycleMs as number) >= 0)
  const cancelledTasks = taskMetrics.filter((t) => t.cancelled)
  const cycleValues = completed.map((t) => t.cycleMs as number)
  const avgCycle = cycleValues.length ? cycleValues.reduce((a, b) => a + b, 0) / cycleValues.length : NaN
  const medCycle = median(cycleValues)

  // Average time a task sits in each status before moving on (completed intervals only).
  const timeInStatus = useMemo(() => {
    const agg: Record<string, { total: number; count: number }> = {}
    for (const { created, events } of taskMetrics) {
      if (!events.length || !isFinite(created)) continue
      let prevAt = created
      let prevStatus = events[0].from // the status it was in before the first recorded change
      for (const ev of events) {
        const dur = ev.at - prevAt
        if (dur >= 0 && prevStatus) {
          agg[prevStatus] ||= { total: 0, count: 0 }
          agg[prevStatus].total += dur
          agg[prevStatus].count += 1
        }
        prevAt = ev.at
        prevStatus = ev.to
      }
    }
    return Object.entries(agg)
      .map(([label, { total, count }]) => ({ label, avg: total / count, count }))
      .sort((a, b) => b.avg - a.avg)
  }, [taskMetrics])

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat(<Timer className="h-4 w-4" />, 'Avg entry → close', fmtDuration(avgCycle), `${completed.length} completed`)}
        {stat(<Clock className="h-4 w-4" />, 'Median entry → close', fmtDuration(medCycle), 'typical task')}
        {stat(<CheckCircle2 className="h-4 w-4" />, 'Completed', String(completed.length), 'measurable cycle')}
        {stat(<XCircle className="h-4 w-4" />, 'Cancelled', String(cancelledTasks.length), 'archived, not done')}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Timer className="h-4 w-4" /> Average time in each status</CardTitle>
        </CardHeader>
        <CardContent>
          {timeInStatus.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Not enough status-change history yet — this fills in as tasks move between statuses.</p>
          ) : (
            <div className="space-y-3">
              {timeInStatus.map((s) => (
                <div key={s.label} className="space-y-1">
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
          <CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Recently completed — entry to close</CardTitle>
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
                    <td className="px-4 py-2 text-muted-foreground">{boardTitleById[task.board_id] || boardTitleById[task.column?.board_id] || '—'}</td>
                    <td className="px-4 py-2">{isFinite(created) ? new Date(created).toLocaleDateString('en-US') : '—'}</td>
                    <td className="px-4 py-2">{closedAt ? new Date(closedAt).toLocaleDateString('en-US') : '—'}</td>
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
