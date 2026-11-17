'use client'

import * as React from 'react'
import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { AppShell } from '@/components/shell/app-shell'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { ThemeControls } from '@/components/theme/theme-controls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { useAppModules } from '@/lib/modules'
import { didWrite, writeFailureMessage } from '@/lib/rls-write'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useNow } from '@/lib/use-now'
import {
  entryDurationMs,
  formatDuration,
  groupByDay,
  localDayKey,
  manualEntryRange,
  toCsv,
  totals,
  type TimeEntry,
} from '@/lib/time-tracking'
import { addEntry, deleteEntry, loadTimeTracking } from '@/lib/time-tracking-data'

interface TimeLogViewProps {
  user: { id: string; role?: string | null; full_name?: string | null; email?: string | null }
  initialEntries: TimeEntry[]
  shell?: ShellData | null
  now: string
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** /time: every session the viewer logged, by day, plus a form for hours worked off the clock. */
export default function TimeLogView({ user, initialEntries, shell, now: serverNow }: TimeLogViewProps) {
  const now = useNow(serverNow)
  const role = (user.role ?? 'user') as 'user' | 'admin' | 'super_admin'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)
  const [entries, setEntries] = useState(initialEntries)
  const [day, setDay] = useState(() => localDayKey(new Date(serverNow)))
  const [start, setStart] = useState('09:00')
  const [hours, setHours] = useState('1')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const groups: SidebarNavGroup[] = useMemo(
    () => buildWorkspaceNav({ role, modules, canUseMarketingCalendar: isAdmin || calendars.length > 0 }),
    [role, modules, isAdmin, calendars.length],
  )

  const sum = totals(entries, now)
  const days = groupByDay(entries, now)

  const refresh = async () => {
    const result = await loadTimeTracking(createClient(), user.id)
    if (result.kind === 'ready') setEntries(result.entries)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const range = manualEntryRange(day, start, Number(hours), new Date())
    if (!range) {
      toast.error('Check the date, start time and hours', { description: 'The session has to be up to 24 hours and finished already.' })
      return
    }
    setSaving(true)
    const result = await addEntry(createClient(), user.id, range, note.trim() || null)
    setSaving(false)
    if (result.kind === 'error') {
      toast.error('Could not log that time', { description: result.message })
      return
    }
    toast.success(`Logged ${formatDuration(entryDurationMs(result.entry, new Date()))}`)
    setNote('')
    void refresh()
  }

  const remove = async (entry: TimeEntry) => {
    const outcome = await deleteEntry(createClient(), entry.id)
    if (!didWrite(outcome)) {
      const message = writeFailureMessage(outcome, 'delete')
      if (message) toast.error(message.title, { description: message.description })
      return
    }
    setEntries((prev) => prev.filter((x) => x.id !== entry.id))
    toast('Entry deleted')
  }

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([toCsv(entries, new Date())], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `hours-${localDayKey(new Date())}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AppShell
      user={{ id: user.id, role, full_name: user.full_name, email: user.email }}
      groups={groups}
      activeId="time"
      breadcrumbs={[{ label: 'Time log' }]}
      topbarActions={<ThemeControls />}
    >
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Time log</h1>
            <p className="text-muted-foreground text-sm">Your hours only. Start and stop the timer in the top bar, or log time here.</p>
          </div>
          {entries.length > 0 && (
            <Button variant="outline" onClick={exportCsv}>
              <Download className="size-4" aria-hidden="true" />
              Export CSV
            </Button>
          )}
        </header>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['Today', sum.today],
              ['This week', sum.week],
              ['This month', sum.month],
              ['All time', sum.all],
            ] as const
          ).map(([label, ms]) => (
            <Card key={label} className="gap-1 py-4">
              <CardContent className="px-4">
                <p className="text-muted-foreground text-xs">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{formatDuration(ms)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Log time</CardTitle>
            <CardDescription>For work you did without the timer running.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_0.8fr_2fr_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="log-day">Date</Label>
                <Input id="log-day" type="date" value={day} max={localDayKey(now)} onChange={(e) => setDay(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="log-start">Start</Label>
                <Input id="log-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="log-hours">Hours</Label>
                <Input id="log-hours" type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="log-note">What did you work on?</Label>
                <Input id="log-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </div>
              <Button type="submit" disabled={saving}>
                <Plus className="size-4" aria-hidden="true" />
                Log
              </Button>
            </form>
          </CardContent>
        </Card>

        {days.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">No hours logged yet.</p>
        ) : (
          <div className="space-y-4">
            {days.map((group) => (
              <Card key={group.day} className="gap-0 py-0">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <h2 className="text-sm font-semibold">{dayLabel(group.day)}</h2>
                  <span className="text-sm font-semibold tabular-nums">{formatDuration(group.totalMs)}</span>
                </div>
                <ul className="divide-y">
                  {group.entries.map((entry) => (
                    <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-muted-foreground w-40 shrink-0 text-sm tabular-nums">
                        {timeLabel(entry.started_at)} to {entry.ended_at ? timeLabel(entry.ended_at) : 'now'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{entry.note || <span className="text-muted-foreground">No note</span>}</span>
                      <span className="text-sm tabular-nums">{formatDuration(entryDurationMs(entry, now))}</span>
                      {entry.ended_at && (
                        <Button variant="ghost" size="icon-sm" onClick={() => void remove(entry)} aria-label={`Delete the ${timeLabel(entry.started_at)} entry`}>
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
