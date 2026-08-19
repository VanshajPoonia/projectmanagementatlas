'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  describeRestrictionDays,
  describeRestrictionTime,
} from '@/lib/appointment-availability'
import RestrictionDialog, {
  type RestrictionDraft,
  type RestrictionRow,
} from './restriction-dialog'
import BookingLinkPanel from './booking-link-panel'
import AppointmentList from './appointment-list'

interface SettingsRow {
  min_duration_minutes: number
  max_duration_minutes: number | null
  required_lead_time_hours: number
  allow_same_day: boolean
  allow_overlaps: boolean
  max_overlaps: number | null
  timezone: string
}

const DEFAULT_SETTINGS: SettingsRow = {
  min_duration_minutes: 30,
  max_duration_minutes: null,
  required_lead_time_hours: 0,
  allow_same_day: true,
  allow_overlaps: false,
  max_overlaps: null,
  timezone: 'America/Chicago',
}

/** Blank input means "no limit", which the schema stores as NULL - not 0. */
function toNullableInt(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export default function AppointmentsView({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<SettingsRow>(DEFAULT_SETTINGS)
  const [restrictions, setRestrictions] = useState<RestrictionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RestrictionRow | null>(null)
  const supabase = createClient()

  const load = useCallback(async () => {
    const [settingsResult, restrictionsResult] = await Promise.all([
      supabase
        .from('appointment_settings')
        .select('min_duration_minutes, max_duration_minutes, required_lead_time_hours, allow_same_day, allow_overlaps, max_overlaps, timezone')
        .eq('user_id', userId)
        .maybeSingle(),
      supabase
        .from('appointment_restrictions')
        .select('id, reason, starts_on, ends_on, is_all_day, starts_at_time, ends_at_time, weekdays')
        .eq('user_id', userId)
        .order('starts_on', { ascending: true }),
    ])

    // No settings row yet is the normal first-run state, not an error - the
    // defaults below mirror the column defaults in migration 080.
    if (settingsResult.data) setSettings({ ...DEFAULT_SETTINGS, ...settingsResult.data })

    if (restrictionsResult.error) {
      toast.error('Could not load restrictions', { description: restrictionsResult.error.message })
    } else {
      setRestrictions((restrictionsResult.data ?? []) as RestrictionRow[])
    }
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    load()
  }, [load])

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    if (settings.max_duration_minutes !== null
        && settings.max_duration_minutes < settings.min_duration_minutes) {
      toast.error('Maximum length cannot be shorter than the minimum')
      return
    }

    setSavingSettings(true)
    // Upsert because the row is created lazily on first save; the table's PK is
    // user_id, so this stays a single row per host.
    const { error } = await supabase
      .from('appointment_settings')
      .upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' })
    setSavingSettings(false)

    if (error) {
      toast.error('Could not save preferences', { description: error.message })
      return
    }
    toast.success('Booking preferences saved')
  }

  const saveRestriction = async (draft: RestrictionDraft) => {
    const payload = { ...draft, user_id: userId }
    const { error } = editing
      ? await supabase.from('appointment_restrictions').update(draft).eq('id', editing.id)
      : await supabase.from('appointment_restrictions').insert({ ...payload, created_by: userId })

    // Thrown rather than toasted so the dialog can surface it inline and stay
    // open with the user's input intact.
    if (error) throw new Error(error.message)

    toast.success(editing ? 'Restriction updated' : 'Restriction added')
    await load()
  }

  const removeRestriction = async (row: RestrictionRow) => {
    const { error } = await supabase.from('appointment_restrictions').delete().eq('id', row.id)
    if (error) {
      toast.error('Could not remove restriction', { description: error.message })
      return
    }
    toast.success('Restriction removed')
    await load()
  }

  const openAdd = () => {
    setEditing(null)
    setDialogOpen(true)
  }

  const openEdit = (row: RestrictionRow) => {
    setEditing(row)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <AppointmentList userId={userId} timezone={settings.timezone} />

      <Card>
        <CardHeader>
          <CardTitle>Booking preferences</CardTitle>
          <CardDescription>
            How long appointments can be and how much notice you need. These apply to every
            booking request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveSettings} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="min-duration">Minimum length (minutes)</Label>
                <Input
                  id="min-duration"
                  type="number"
                  min={5}
                  max={1440}
                  value={settings.min_duration_minutes}
                  onChange={e => setSettings(s => ({ ...s, min_duration_minutes: Number(e.target.value) }))}
                  disabled={savingSettings}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-duration">Maximum length (minutes)</Label>
                <Input
                  id="max-duration"
                  type="number"
                  min={5}
                  max={1440}
                  placeholder="No maximum"
                  value={settings.max_duration_minutes ?? ''}
                  onChange={e => setSettings(s => ({ ...s, max_duration_minutes: toNullableInt(e.target.value) }))}
                  disabled={savingSettings}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-time">Required notice (hours)</Label>
                <Input
                  id="lead-time"
                  type="number"
                  min={0}
                  max={720}
                  value={settings.required_lead_time_hours}
                  onChange={e => setSettings(s => ({ ...s, required_lead_time_hours: Number(e.target.value) }))}
                  disabled={savingSettings}
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-input"
                  checked={settings.allow_same_day}
                  onChange={e => setSettings(s => ({ ...s, allow_same_day: e.target.checked }))}
                  disabled={savingSettings}
                />
                Allow same-day bookings
              </label>

              <label className="flex items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-input"
                  checked={settings.allow_overlaps}
                  onChange={e => setSettings(s => ({ ...s, allow_overlaps: e.target.checked }))}
                  disabled={savingSettings}
                />
                Allow overlapping appointments
              </label>

              {settings.allow_overlaps && (
                <div className="ml-7 max-w-xs space-y-1.5">
                  <Label htmlFor="max-overlaps">Maximum at the same time</Label>
                  <Input
                    id="max-overlaps"
                    type="number"
                    min={1}
                    max={100}
                    placeholder="No limit"
                    value={settings.max_overlaps ?? ''}
                    onChange={e => setSettings(s => ({ ...s, max_overlaps: toNullableInt(e.target.value) }))}
                    disabled={savingSettings}
                  />
                </div>
              )}
            </div>

            <Button type="submit" disabled={savingSettings}>
              {savingSettings ? 'Saving…' : 'Save preferences'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Restrictions</CardTitle>
            <CardDescription>
              Periods when you will not take appointments. A repeating restriction applies only on
              the days you pick, within its date range.
            </CardDescription>
          </div>
          <Button onClick={openAdd} className="flex-shrink-0 gap-2">
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : restrictions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No restrictions yet. You are bookable whenever your preferences allow.
            </p>
          ) : (
            <div className="space-y-2">
              {restrictions.map(row => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.reason}</span>
                      <Badge variant="outline" className="text-muted-foreground">
                        {describeRestrictionDays(row)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {row.starts_on} – {row.ends_on} · {describeRestrictionTime(row)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => openEdit(row)}
                      aria-label={`Edit ${row.reason}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeRestriction(row)}
                      aria-label={`Remove ${row.reason}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <BookingLinkPanel userId={userId} />

      <RestrictionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSave={saveRestriction}
      />
    </div>
  )
}
