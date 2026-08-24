'use client'

/**
 * Personal reminders on a task - the consumer side of migration 117.
 *
 * A reminder belongs to the PERSON, not the task. Two people watching the same task can each
 * set their own warning time and neither sees the other's, which is why there is no roster here
 * and no "who else has a reminder" affordance: 117's policies are keyed on auth.uid() with no
 * admin bypass, so this panel could not show one truthfully even if it wanted to.
 *
 * ⚠️ Absence of a row here is not evidence about anyone else. Everything drawn on this panel is
 * scoped to the signed-in user by RLS, and that is stated on screen rather than left to be
 * inferred - the "hidden from you vs does not exist" trap the repo has hit repeatedly.
 *
 * Every reminder can be edited or deleted right up until it fires. Once delivered, the row goes
 * read-only: it is a record of a notification that was actually sent, and rewriting it would
 * make the panel disagree with the inbox.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bell, Pencil, Plus, Trash2, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage, didWrite } from '@/lib/rls-write'

interface TaskRemindersPanelProps {
  taskId: string
  currentUserId: string
  /** Used to explain what a relative reminder resolves to, and to disable them when absent. */
  dueDate?: string | null
}

interface Reminder {
  id: string
  remind_at: string | null
  offset_minutes: number | null
  channel: 'in_app' | 'email' | 'both'
  note: string | null
  delivered_at: string | null
}

/** Offsets people actually ask for. Minutes, matching the column. */
const OFFSETS: readonly { minutes: number; label: string }[] = [
  { minutes: 0, label: 'At the due time' },
  { minutes: 30, label: '30 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 1440, label: '1 day before' },
  { minutes: 2880, label: '2 days before' },
  { minutes: 10080, label: '1 week before' },
]

const CHANNEL_LABELS: Record<Reminder['channel'], string> = {
  in_app: 'In the app',
  email: 'Email only',
  both: 'App and email',
}

function describeReminder(r: Reminder): string {
  if (r.offset_minutes !== null) {
    return OFFSETS.find((o) => o.minutes === r.offset_minutes)?.label ?? `${r.offset_minutes} minutes before`
  }
  if (!r.remind_at) return 'Unscheduled'
  return new Date(r.remind_at).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

export default function TaskRemindersPanel({ taskId, currentUserId, dueDate }: TaskRemindersPanelProps) {
  const supabase = createClient()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  // One form, two jobs. 117 grants UPDATE on (remind_at, offset_minutes, channel, note) and
  // nothing consumed it - a granted ability with no route to it, the same defect as an
  // unreachable operation, just pointing the other way. `editingId` is 'new' while adding and
  // a reminder's id while changing one.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [kind, setKind] = useState<'relative' | 'absolute'>('relative')
  const [offset, setOffset] = useState(1440)
  const [at, setAt] = useState('')
  const [channel, setChannel] = useState<Reminder['channel']>('in_app')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('task_reminders')
      .select('id, remind_at, offset_minutes, channel, note, delivered_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
    setReminders((data as any[]) ?? [])
    setLoading(false)
  }, [supabase, taskId])

  useEffect(() => { load() }, [load])

  // A relative reminder has nothing to be relative to without a due date. Offering it anyway
  // would create a row that silently never fires.
  const canUseRelative = Boolean(dueDate)

  useEffect(() => {
    if (!canUseRelative && kind === 'relative') setKind('absolute')
  }, [canUseRelative, kind])

  /** Load an existing reminder into the form. Delivered ones are read-only - see below. */
  function startEditing(r: Reminder) {
    setEditingId(r.id)
    setKind(r.offset_minutes !== null ? 'relative' : 'absolute')
    if (r.offset_minutes !== null) setOffset(r.offset_minutes)
    // datetime-local wants local wall time with no zone, which toISOString() does not give.
    if (r.remind_at) {
      const d = new Date(r.remind_at)
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      setAt(local.toISOString().slice(0, 16))
    }
    setChannel(r.channel)
    setNote(r.note ?? '')
  }

  function startAdding() {
    setEditingId('new')
    setKind(canUseRelative ? 'relative' : 'absolute')
    setOffset(1440)
    setAt('')
    setChannel('in_app')
    setNote('')
  }

  async function handleAdd() {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        task_id: taskId,
        user_id: currentUserId,
        channel,
        note: note.trim() || null,
        // Exactly one shape, enforced by 117's XOR CHECK. Sending both would be refused.
        remind_at: kind === 'absolute' ? new Date(at).toISOString() : null,
        offset_minutes: kind === 'relative' ? offset : null,
      }

      // An UPDATE deliberately does NOT send task_id or user_id: 117 grants neither column,
      // so including them would be refused outright rather than ignored.
      const result = editingId && editingId !== 'new'
        ? await supabase.from('task_reminders').update({
            channel,
            note: note.trim() || null,
            remind_at: kind === 'absolute' ? new Date(at).toISOString() : null,
            offset_minutes: kind === 'relative' ? offset : null,
          }).eq('id', editingId).select()
        : await supabase.from('task_reminders').insert(payload).select()
      const outcome = await classifyWrite(result as any)
      if (!didWrite(outcome)) {
        const msg = writeFailureMessage(outcome, 'reminder')
        toast.error(msg?.title ?? 'Not saved', { description: msg?.description })
        return
      }

      toast.success(editingId && editingId !== 'new' ? 'Reminder updated' : 'Reminder set')
      setEditingId(null)
      setNote('')
      await load()
    } catch (err: any) {
      // The unique index is per (task, person, time), so this is the one error worth
      // translating: the raw 23505 says nothing a user can act on.
      const duplicate = err?.code === '23505' || /duplicate key/i.test(err?.message ?? '')
      toast.error(duplicate ? 'You already have that reminder on this task' : 'Could not set that reminder', {
        description: duplicate ? undefined : err?.message,
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const result = await supabase.from('task_reminders').delete().eq('id', id).select()
    const outcome = await classifyWrite(result as any)
    if (!didWrite(outcome)) {
      const msg = writeFailureMessage(outcome, 'reminder')
      toast.error(msg?.title ?? 'Not removed', { description: msg?.description })
      return
    }
    toast.success('Reminder removed')
    await load()
  }

  if (loading) return <div className="text-sm text-muted-foreground">Loading reminders...</div>

  return (
    <div className="space-y-3" data-testid="reminders-panel">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Bell className="h-4 w-4" aria-hidden />
          Your reminders
        </Label>
        {!editingId && (
          <Button variant="ghost" size="sm" onClick={startAdding}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        )}
      </div>

      {reminders.length === 0 && !editingId && (
        <p className="text-sm text-muted-foreground">
          No reminders. These are private to you - nobody else on this task sees or is affected by them.
        </p>
      )}

      {reminders.length > 0 && (
        <div className="space-y-1.5">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              {r.delivered_at
                ? <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                : <Bell className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className={r.delivered_at ? 'text-muted-foreground line-through' : ''}>
                {describeReminder(r)}
              </span>
              <Badge variant="outline" className="shrink-0 text-[10px]">{CHANNEL_LABELS[r.channel]}</Badge>
              {r.note && <span className="truncate text-xs text-muted-foreground">"{r.note}"</span>}
              {r.delivered_at && <Badge variant="secondary" className="shrink-0 text-[10px]">Sent</Badge>}
              {/* A delivered reminder is read-only: it records a notification that was really
                  sent, and rewriting it would make this panel disagree with the inbox. */}
              {!r.delivered_at && (
                <Button
                  variant="ghost" size="sm"
                  className="ml-auto h-7 shrink-0 px-2"
                  onClick={() => startEditing(r)}
                  aria-label={`Edit reminder ${describeReminder(r)}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost" size="sm"
                className={`h-7 shrink-0 px-2 text-destructive ${r.delivered_at ? 'ml-auto' : ''}`}
                onClick={() => handleDelete(r.id)}
                aria-label={`Remove reminder ${describeReminder(r)}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(['relative', 'absolute'] as const).map((k) => (
              <button
                key={k}
                type="button"
                disabled={k === 'relative' && !canUseRelative}
                onClick={() => setKind(k)}
                className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  kind === k ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {k === 'relative' ? 'Before it is due' : 'At a set time'}
              </button>
            ))}
          </div>

          {!canUseRelative && (
            <p className="text-xs text-muted-foreground">
              This task has no due date, so a reminder has to be set for a specific time.
            </p>
          )}

          {kind === 'relative' ? (
            <div className="space-y-1.5">
              <Label htmlFor="rem-offset" className="text-xs">How far ahead</Label>
              <Select value={String(offset)} onValueChange={(v) => setOffset(Number(v))}>
                <SelectTrigger id="rem-offset"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OFFSETS.map((o) => <SelectItem key={o.minutes} value={String(o.minutes)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {/* A relative reminder follows the due date. Saying so beats a user discovering
                  it by moving the date and wondering whether the reminder moved too. */}
              <p className="text-xs text-muted-foreground">Moves with the due date if it changes.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rem-at" className="text-xs">Remind me at</Label>
              <Input id="rem-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rem-channel" className="text-xs">Where</Label>
            <Select value={channel} onValueChange={(v: Reminder['channel']) => setChannel(v)}>
              <SelectTrigger id="rem-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CHANNEL_LABELS) as Reminder['channel'][]).map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABELS[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {channel !== 'in_app' && (
              <p className="text-xs text-muted-foreground">
                Email also depends on your "Due date reminders" setting in Account settings.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rem-note" className="text-xs">Note (optional)</Label>
            <Input
              id="rem-note" value={note} maxLength={2000}
              placeholder="Ring the supplier first"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={saving}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={saving || (kind === 'absolute' && !at)}
            >
              {saving ? 'Saving...' : editingId === 'new' ? 'Set reminder' : 'Update reminder'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
