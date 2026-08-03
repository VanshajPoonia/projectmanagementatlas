'use client'

import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  expandRestrictionDates,
  validateRestrictionDraft,
  type AppointmentRestriction,
} from '@/lib/appointment-availability'

// Sunday-first, matching the source recording's checkbox row and the 0=Sunday
// convention stored in appointment_restrictions.weekdays.
const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

export interface RestrictionRow extends AppointmentRestriction {
  id: string
  reason: string
}

export interface RestrictionDraft {
  reason: string
  starts_on: string
  ends_on: string
  is_all_day: boolean
  starts_at_time: string | null
  ends_at_time: string | null
  weekdays: number[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null means "add new"; a row means "edit that row". */
  editing: RestrictionRow | null
  onSave: (draft: RestrictionDraft) => Promise<void>
}

function emptyDraft(): RestrictionDraft {
  return {
    reason: '',
    starts_on: '',
    ends_on: '',
    is_all_day: false,
    starts_at_time: '09:00',
    ends_at_time: '17:00',
    weekdays: [],
  }
}

export default function RestrictionDialog({ open, onOpenChange, editing, onSave }: Props) {
  const [draft, setDraft] = useState<RestrictionDraft>(emptyDraft)
  // "Repeating" is a UI mode, not a stored column: it maps onto whether weekdays
  // is populated. Keeping it in local state means unticking every day doesn't
  // silently flip the row back to one-time while the user is still editing.
  const [repeating, setRepeating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setDraft({
        reason: editing.reason,
        starts_on: editing.starts_on,
        ends_on: editing.ends_on,
        is_all_day: editing.is_all_day,
        starts_at_time: editing.starts_at_time?.slice(0, 5) ?? '09:00',
        ends_at_time: editing.ends_at_time?.slice(0, 5) ?? '17:00',
        weekdays: editing.weekdays ?? [],
      })
      setRepeating((editing.weekdays ?? []).length > 0)
    } else {
      setDraft(emptyDraft())
      setRepeating(false)
    }
    setError(null)
  }, [open, editing])

  const update = <K extends keyof RestrictionDraft>(key: K, value: RestrictionDraft[K]) => {
    setDraft(prev => ({ ...prev, [key]: value }))
    setError(null)
  }

  const toggleWeekday = (day: number) => {
    setDraft(prev => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter(d => d !== day)
        : [...prev.weekdays, day].sort((a, b) => a - b),
    }))
    setError(null)
  }

  // A one-time restriction is stored as an empty weekday set, so drop the
  // selection when the mode is off rather than persisting invisible state.
  const effectiveDraft: RestrictionDraft = {
    ...draft,
    weekdays: repeating ? draft.weekdays : [],
    starts_at_time: draft.is_all_day ? null : draft.starts_at_time,
    ends_at_time: draft.is_all_day ? null : draft.ends_at_time,
  }

  // Live preview of what the rule actually lands on. A repeating rule whose days
  // never occur inside its own range is easy to build by accident and otherwise
  // saves happily while blocking nothing.
  const matchedDates = effectiveDraft.starts_on && effectiveDraft.ends_on
    ? expandRestrictionDates(effectiveDraft, 400)
    : []

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateRestrictionDraft(effectiveDraft)
    if (problem) {
      setError(problem)
      return
    }

    setSaving(true)
    try {
      await onSave(effectiveDraft)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this restriction.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit restriction' : 'Add restriction'}</DialogTitle>
          <DialogDescription>
            Block out a period when you will not take appointments.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="restriction-reason">Reason</Label>
            <Input
              id="restriction-reason"
              value={draft.reason}
              onChange={e => update('reason', e.target.value)}
              placeholder="e.g. Out of office"
              maxLength={200}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="restriction-start">Start date</Label>
              <Input
                id="restriction-start"
                type="date"
                value={draft.starts_on}
                onChange={e => update('starts_on', e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="restriction-end">End date</Label>
              <Input
                id="restriction-end"
                type="date"
                value={draft.ends_on}
                onChange={e => update('ends_on', e.target.value)}
                disabled={saving}
              />
            </div>
          </div>

          <label className="flex items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-input"
              checked={repeating}
              onChange={e => setRepeating(e.target.checked)}
              disabled={saving}
            />
            Repeating restriction
          </label>

          {repeating && (
            <div className="space-y-2 rounded-lg border p-3">
              <Label className="text-xs text-muted-foreground">Repeat on</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map(day => {
                  const active = draft.weekdays.includes(day.value)
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleWeekday(day.value)}
                      disabled={saving}
                      aria-pressed={active}
                      className={`h-9 min-w-[3rem] rounded-md border px-2 text-sm font-medium transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-accent'
                      }`}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer rounded border-input"
              checked={draft.is_all_day}
              onChange={e => update('is_all_day', e.target.checked)}
              disabled={saving}
            />
            All day
          </label>

          {!draft.is_all_day && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="restriction-start-time">Start time</Label>
                <Input
                  id="restriction-start-time"
                  type="time"
                  value={draft.starts_at_time ?? ''}
                  onChange={e => update('starts_at_time', e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="restriction-end-time">End time</Label>
                <Input
                  id="restriction-end-time"
                  type="time"
                  value={draft.ends_at_time ?? ''}
                  onChange={e => update('ends_at_time', e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          )}

          {matchedDates.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Blocks {matchedDates.length} day{matchedDates.length === 1 ? '' : 's'}
              {matchedDates.length <= 6 ? `: ${matchedDates.join(', ')}` : ''}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add restriction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
