'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { describeSlotProblem, zonedTimeToUtcMs } from '@/lib/appointment-booking'
import type { AppointmentRestriction, AppointmentSettings } from '@/lib/appointment-availability'

interface Props {
  token: string
  hostName: string
  settings: AppointmentSettings
  restrictions: AppointmentRestriction[]
  existing: { starts_at: string; ends_at: string }[]
}

export default function BookingForm({ token, hostName, settings, restrictions, existing }: Props) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(settings.min_duration_minutes)
  const [guestName, setGuestName] = useState('')
  const [guestEmail, setGuestEmail] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ startsAt: string; endsAt: string; cancelToken: string } | null>(null)

  // All times shown are the HOST's timezone, never the visitor's browser zone —
  // showing two zones side by side invites exactly the kind of off-by-one-hour
  // confusion this form exists to avoid.
  const { startMs, endMs } = useMemo(() => {
    if (!date || !time) return { startMs: NaN, endMs: NaN }
    const start = zonedTimeToUtcMs(date, time, settings.timezone)
    return { startMs: start, endMs: start + duration * 60000 }
  }, [date, time, duration, settings.timezone])

  const preview = useMemo(() => {
    if (!Number.isFinite(startMs)) return null
    // Convenience only — book_appointment() re-validates everything server-side.
    return describeSlotProblem({ settings, restrictions, existing, startMs, endMs })
  }, [settings, restrictions, existing, startMs, endMs])

  const canSubmit = date && time && guestName.trim() && guestEmail.trim() && !preview && !submitting

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/book/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startsAt: new Date(startMs).toISOString(),
          endsAt: new Date(endMs).toISOString(),
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          guestPhone: guestPhone.trim() || undefined,
          note: note.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Could not book this appointment.')
        return
      }
      setConfirmed({ startsAt: body.startsAt, endsAt: body.endsAt, cancelToken: body.cancelToken })
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone, weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
    return (
      <Card>
        <CardContent className="space-y-3 pt-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-600 dark:text-green-400" />
          <h1 className="text-lg font-semibold">Appointment confirmed</h1>
          <p className="text-sm text-muted-foreground">{fmt.format(new Date(confirmed.startsAt))}</p>
          <p className="text-xs text-muted-foreground">A confirmation email is on its way to {guestEmail}.</p>
          <a href={`/book/cancel/${confirmed.cancelToken}`} className="inline-block text-xs text-primary underline underline-offset-2">
            Need to cancel?
          </a>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Book an appointment with {hostName}</CardTitle>
        <CardDescription>
          Times are shown in {hostName}&apos;s timezone ({settings.timezone}).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="book-date">Date</Label>
              <Input id="book-date" type="date" value={date} onChange={e => setDate(e.target.value)} disabled={submitting} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="book-time">Start time</Label>
              <Input id="book-time" type="time" value={time} onChange={e => setTime(e.target.value)} disabled={submitting} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="book-duration">Length (minutes)</Label>
            <Input
              id="book-duration"
              type="number"
              min={settings.min_duration_minutes}
              max={settings.max_duration_minutes ?? undefined}
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              disabled={submitting}
            />
          </div>

          {preview && (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              {preview}
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="book-name">Your name</Label>
            <Input id="book-name" value={guestName} onChange={e => setGuestName(e.target.value)} disabled={submitting} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="book-email">Email</Label>
            <Input id="book-email" type="email" value={guestEmail} onChange={e => setGuestEmail(e.target.value)} disabled={submitting} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="book-phone">Phone (optional)</Label>
            <Input id="book-phone" type="tel" value={guestPhone} onChange={e => setGuestPhone(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="book-note">Note (optional)</Label>
            <Textarea id="book-note" value={note} onChange={e => setNote(e.target.value)} disabled={submitting} maxLength={1000} rows={3} />
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Book appointment'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
