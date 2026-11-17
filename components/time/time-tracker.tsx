'use client'

import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, Play, Square, Timer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { isRequestAborted } from '@/lib/request-aborted'
import { didWrite, writeFailureMessage } from '@/lib/rls-write'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  entryDurationMs,
  formatClock,
  formatDuration,
  runningEntry,
  spokenDuration,
  toCsv,
  totals,
  type TimeEntry,
} from '@/lib/time-tracking'
import {
  deleteEntry,
  loadTimeTracking,
  restoreEntry,
  saveNote,
  startTimer,
  stopTimer,
} from '@/lib/time-tracking-data'

const RECENT_COUNT = 8

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Start/stop timer in the topbar, behind the `time_tracking` module (migration 137).
 * Renders nothing until it has loaded, so the server and client never disagree about the clock.
 */
export function TimeTracker({ userId }: { userId?: string | null }) {
  const [status, setStatus] = useState<'loading' | 'off' | 'ready'>('loading')
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [now, setNow] = useState<Date>(() => new Date(0))
  const [draftNote, setDraftNote] = useState('')
  const [busy, setBusy] = useState(false)

  const running = useMemo(() => runningEntry(entries), [entries])

  const refresh = useCallback(async () => {
    if (!userId) return
    const result = await loadTimeTracking(createClient(), userId)
    if (result.kind === 'error') {
      if (!isRequestAborted(result.error)) console.error('[time-tracker] load failed:', result.error)
      return
    }
    setNow(new Date())
    if (result.kind === 'off') {
      setStatus('off')
      return
    }
    setEntries(result.entries)
    setDraftNote(runningEntry(result.entries)?.note ?? '')
    setStatus('ready')
  }, [userId])

  useEffect(() => {
    void refresh()
    // Another tab or device may have started or stopped the timer.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [running])

  if (!userId || status !== 'ready') return null

  const supabase = createClient()
  const sum = totals(entries, now)
  const elapsed = running ? entryDurationMs(running, now) : 0
  const recent = entries.filter((e) => e.ended_at !== null).slice(0, RECENT_COUNT)

  const start = async () => {
    setBusy(true)
    const result = await startTimer(supabase, userId, draftNote.trim() || null)
    setBusy(false)
    if (result.kind === 'ok') {
      setNow(new Date())
      setEntries((prev) => [result.entry, ...prev])
      return
    }
    if (result.kind === 'already-running') toast.info('A timer is already running in another tab.')
    else toast.error('Could not start the timer', { description: result.message })
    void refresh()
  }

  const stop = async () => {
    if (!running) return
    setBusy(true)
    const note = draftNote.trim() || null
    if (note !== running.note && !didWrite(await saveNote(supabase, running.id, note))) {
      toast.error('The note for this session was not saved')
    }
    const outcome = await stopTimer(supabase, running)
    setBusy(false)
    if (didWrite(outcome)) {
      toast.success(`Logged ${formatDuration(elapsed)}`)
      setDraftNote('')
    } else if (outcome.kind === 'refused') {
      toast.info('This timer was already stopped somewhere else.')
    } else {
      const message = writeFailureMessage(outcome, 'stop')
      if (message) toast.error(message.title, { description: message.description })
    }
    void refresh()
  }

  const commitNote = async () => {
    if (!running) return
    const note = draftNote.trim() || null
    if (note === running.note) return
    const outcome = await saveNote(supabase, running.id, note)
    if (didWrite(outcome)) {
      setEntries((prev) => prev.map((e) => (e.id === running.id ? { ...e, note } : e)))
      return
    }
    const message = writeFailureMessage(outcome, 'note')
    if (message) toast.error(message.title, { description: message.description })
  }

  const remove = async (entry: TimeEntry) => {
    const outcome = await deleteEntry(supabase, entry.id)
    if (!didWrite(outcome)) {
      const message = writeFailureMessage(outcome, 'delete')
      if (message) toast.error(message.title, { description: message.description })
      return
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    toast('Entry deleted', {
      action: {
        label: 'Undo',
        onClick: async () => {
          const restored = await restoreEntry(supabase, userId, entry)
          if (!didWrite(restored)) toast.error('Could not restore that entry')
          void refresh()
        },
      },
    })
  }

  const exportCsv = () => {
    const blob = new Blob([toCsv(entries, new Date())], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `hours-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const label = running
    ? `Time tracker, running for ${spokenDuration(elapsed)}`
    : 'Time tracker, not running'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          title={label}
          data-testid="time-tracker"
          data-running={running ? 'true' : 'false'}
          className={cn(
            'text-muted-foreground hover:text-foreground h-9 shrink-0 gap-1.5 px-2',
            running && 'text-foreground',
          )}
        >
          <span className="relative inline-flex">
            <Timer className="size-4" aria-hidden="true" />
            {running && (
              <span
                aria-hidden="true"
                className="bg-primary absolute -top-0.5 -right-0.5 size-2 rounded-full motion-safe:animate-pulse"
              />
            )}
          </span>
          {running && (
            <span className="hidden font-mono text-xs tabular-nums sm:inline" aria-hidden="true">
              {formatClock(elapsed)}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Time tracker</h2>
            <span className="text-muted-foreground text-xs">Only you can see these</span>
          </div>

          <p className="font-mono text-3xl font-semibold tabular-nums" aria-live="off">
            {formatClock(elapsed)}
          </p>

          <Input
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onBlur={() => void commitNote()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void (running ? commitNote() : start())
            }}
            maxLength={500}
            placeholder="What are you working on?"
            aria-label="What are you working on?"
          />

          {running ? (
            <Button onClick={() => void stop()} disabled={busy} variant="destructive" className="w-full">
              <Square className="size-4" aria-hidden="true" />
              Stop timer
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={busy} className="w-full">
              <Play className="size-4" aria-hidden="true" />
              Start timer
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-4 border-y text-center">
          {(
            [
              ['Today', sum.today],
              ['Week', sum.week],
              ['Month', sum.month],
              ['All', sum.all],
            ] as const
          ).map(([name, ms]) => (
            <div key={name} className="px-1 py-2">
              <dt className="text-muted-foreground text-[11px]">{name}</dt>
              <dd className="text-xs font-medium tabular-nums">{formatDuration(ms)}</dd>
            </div>
          ))}
        </dl>

        <div className="max-h-56 overflow-y-auto p-2">
          {recent.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">No finished sessions yet.</p>
          ) : (
            <ul className="space-y-1">
              {recent.map((entry) => (
                <li key={entry.id} className="hover:bg-accent group flex items-start gap-2 rounded-md px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-medium">{dayLabel(entry.started_at)}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        {timeLabel(entry.started_at)} to {timeLabel(entry.ended_at!)}
                      </span>
                    </p>
                    {entry.note && <p className="text-muted-foreground truncate text-xs">{entry.note}</p>}
                  </div>
                  <span className="text-xs tabular-nums">{formatDuration(entryDurationMs(entry, now))}</span>
                  <button
                    type="button"
                    onClick={() => void remove(entry)}
                    aria-label={`Delete the ${dayLabel(entry.started_at)} entry`}
                    className="text-muted-foreground hover:text-destructive focus-visible:ring-ring rounded outline-none focus-visible:ring-2"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-1 border-t p-2">
          <Button variant="ghost" size="sm" asChild className="flex-1">
            <Link href="/time">Open time log</Link>
          </Button>
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportCsv} className="flex-1">
              <Download className="size-4" aria-hidden="true" />
              CSV
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
