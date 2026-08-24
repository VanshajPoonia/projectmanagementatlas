'use client'

/**
 * Recurrence on a work item - the consumer side of migration 116.
 *
 * This REPLACES the toggle that 025 and 086 put on the create and edit dialogs. That control
 * wrote five columns on `tasks` and nothing anywhere read them: a user could mark a task
 * "repeats weekly", see it confirmed on the card, and receive nothing, forever. So the first
 * job of this panel is to only ever claim what is true.
 *
 * Three states it must tell apart, which is why it is a panel and not a switch:
 *
 *   1. No rule. Offer to create one.
 *   2. A real rule. Show the cadence, the mode, how many instances it has produced, and the
 *      dates it produced them on. The occurrence ledger is read-only everywhere including here
 *      (only 116's generator writes it), so this is a record, not a control.
 *   3. LEGACY: tasks.is_recurring is true but no rule exists. That is the four production rows
 *      carrying a NULL pattern, which 116 deliberately refused to guess a cadence for. They get
 *      a plain explanation and a prefilled form, never a silent default.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Repeat, Play, Pause, Trash2, AlertTriangle, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage, didWrite } from '@/lib/rls-write'
import {
  FREQUENCIES,
  GENERATION_MODES,
  GENERATION_MODE_LABELS,
  FREQUENCY_LABELS,
  WEEKDAY_LABELS,
  describeRule,
  previewOccurrences,
  ruleRejectionReason,
  ruleFromLegacyTask,
  todayInBusinessZone,
  type Frequency,
  type GenerationMode,
  type RecurrenceRule,
} from '@/lib/recurrence'

interface TaskRecurrencePanelProps {
  taskId: string
  canEdit: boolean
  currentUserId: string
  /** The legacy flags from 025/086, used only to detect state 3 above. */
  legacy?: {
    is_recurring?: boolean | null
    recurrence_pattern?: string | null
    recurrence_interval?: number | null
    recurrence_weekdays?: number[] | null
    recurrence_end_date?: string | null
    due_date?: string | null
    created_at?: string | null
  }
  onGenerated?: () => void
}

const BLANK: RecurrenceRule = {
  frequency: 'weekly',
  interval_count: 1,
  weekdays: null,
  month_day: null,
  generation_mode: 'on_completion',
  horizon_days: 30,
  starts_on: '',
  ends_on: null,
  max_occurrences: null,
  is_paused: false,
}

export default function TaskRecurrencePanel({
  taskId, canEdit, currentUserId, legacy, onGenerated,
}: TaskRecurrencePanelProps) {
  const supabase = createClient()
  const [rule, setRule] = useState<(RecurrenceRule & { id: string }) | null>(null)
  const [occurrences, setOccurrences] = useState<{ occurrence_date: string; task_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<RecurrenceRule>(BLANK)
  const [saving, setSaving] = useState(false)

  const today = todayInBusinessZone()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('recurrence_rules')
      .select('*')
      .eq('source_task_id', taskId)
      .maybeSingle()

    const found = (data as any) ?? null
    setRule(found)

    if (found) {
      const { data: occ } = await supabase
        .from('recurrence_occurrences')
        .select('occurrence_date, task_id')
        .eq('rule_id', found.id)
        .order('occurrence_date', { ascending: false })
        .limit(12)
      setOccurrences((occ as any[]) ?? [])
    } else {
      setOccurrences([])
    }
    setLoading(false)
  }, [supabase, taskId])

  useEffect(() => { load() }, [load])

  // State 3: flagged recurring by the old columns, with no rule to show for it.
  const legacyOrphan = Boolean(legacy?.is_recurring) && !rule && !loading
  const legacySuggestion = useMemo(() => (legacy ? ruleFromLegacyTask(legacy) : null), [legacy])

  const rejection = editing ? ruleRejectionReason(draft) : null
  const preview = useMemo(
    () => (editing && draft.generation_mode === 'schedule' && !rejection
      ? previewOccurrences(draft, 5, today)
      : []),
    [editing, draft, rejection, today],
  )

  function startEditing(from?: RecurrenceRule) {
    setDraft(from ? { ...from } : { ...BLANK, starts_on: today })
    setEditing(true)
  }

  async function handleSave() {
    const reason = ruleRejectionReason(draft)
    if (reason) { toast.error(reason); return }
    setSaving(true)
    try {
      const payload = {
        frequency: draft.frequency,
        interval_count: draft.interval_count,
        // The CHECK constraints refuse weekdays on a non-weekly rule and a month day on a
        // non-monthly one, so they are nulled here rather than sent and rejected.
        weekdays: draft.frequency === 'weekly' && draft.weekdays?.length ? draft.weekdays : null,
        month_day: draft.frequency === 'monthly' ? draft.month_day : null,
        generation_mode: draft.generation_mode,
        horizon_days: draft.horizon_days,
        starts_on: draft.starts_on,
        ends_on: draft.ends_on || null,
        max_occurrences: draft.max_occurrences || null,
      }

      const result = rule
        ? await supabase.from('recurrence_rules').update(payload).eq('id', rule.id).select()
        : await supabase.from('recurrence_rules')
            .insert({ ...payload, source_task_id: taskId, created_by: currentUserId }).select()

      // A zero-row write is an RLS refusal, not an error. No visibility probe is needed:
      // nothing in this payload is an input to the rule's own SELECT policy, which keys off
      // the source task.
      const outcome = await classifyWrite(result as any)
      if (!didWrite(outcome)) {
        const msg = writeFailureMessage(outcome, 'schedule')
        toast.error(msg?.title ?? 'Not saved', { description: msg?.description })
        return
      }

      // Prompt D: editing a schedule must not rewrite completed history SILENTLY. It cannot
      // rewrite it at all - `authenticated` holds SELECT and nothing else on the ledger, and
      // this payload never mentions it - but "cannot" is only half the requirement. Say what
      // happened to the work already produced, the same way handleDelete does, so the user is
      // not left guessing whether an edit reached backwards.
      const kept = occurrences.length
      toast.success(rule ? 'Schedule updated' : 'Schedule created', {
        description: rule && kept > 0
          ? `The ${kept} task${kept === 1 ? '' : 's'} it already created ${kept === 1 ? 'was' : 'were'} left alone. The new schedule applies from the next one.`
          : undefined,
      })
      setEditing(false)
      await load()
    } catch (err: any) {
      toast.error('Could not save the schedule', { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  async function togglePaused() {
    if (!rule) return
    const result = await supabase
      .from('recurrence_rules').update({ is_paused: !rule.is_paused }).eq('id', rule.id).select()
    const outcome = await classifyWrite(result as any)
    if (!didWrite(outcome)) {
      const msg = writeFailureMessage(outcome, 'change')
      toast.error(msg?.title ?? 'Not saved', { description: msg?.description })
      return
    }
    toast.success(rule.is_paused ? 'Schedule resumed' : 'Schedule paused')
    await load()
  }

  async function handleDelete() {
    if (!rule) return
    const result = await supabase.from('recurrence_rules').delete().eq('id', rule.id).select()
    const outcome = await classifyWrite(result as any)
    if (!didWrite(outcome)) {
      const msg = writeFailureMessage(outcome, 'schedule')
      toast.error(msg?.title ?? 'Not removed', { description: msg?.description })
      return
    }
    // Tasks the rule already produced are deliberately left alone. They are real work that
    // someone may already have started; deleting the schedule is not a statement about them.
    toast.success('Schedule removed', { description: 'Tasks it already created were kept.' })
    await load()
  }

  async function runNow() {
    if (!rule) return
    const { data, error } = await supabase.rpc('run_recurrence_generation', { p_rule_id: rule.id })
    if (error) { toast.error('Could not run the schedule', { description: error.message }); return }
    const rows = (data as any[]) ?? []
    const created = rows.reduce((sum, r) => sum + (r.created_count ?? 0), 0)
    const reason = rows.find((r) => r.skipped_reason)?.skipped_reason

    // Reporting "done" when the generator created nothing is the exact defect this whole
    // feature exists to end, so the skip reason is surfaced verbatim.
    if (created > 0) {
      toast.success(`${created} ${created === 1 ? 'task' : 'tasks'} created`)
      onGenerated?.()
    } else {
      toast.info('Nothing to create', { description: reason ?? 'This schedule is already up to date.' })
    }
    await load()
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading schedule...</div>
  }

  return (
    <div className="space-y-3" data-testid="recurrence-panel">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Repeat className="h-4 w-4" aria-hidden />
          Repeats
        </Label>
        {rule && !editing && canEdit && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={runNow} title="Generate any occurrences that are due now">
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Run now
            </Button>
            <Button variant="ghost" size="sm" onClick={togglePaused}>
              {rule.is_paused
                ? <><Play className="mr-1 h-3.5 w-3.5" /> Resume</>
                : <><Pause className="mr-1 h-3.5 w-3.5" /> Pause</>}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => startEditing(rule)}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={handleDelete} className="text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* State 3: the old flag with nothing behind it. */}
      {legacyOrphan && !editing && (
        <Alert data-testid="recurrence-legacy">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>
              This task is marked as repeating, but it has no schedule, so nothing has ever been
              created from it. {legacySuggestion
                ? 'Its old settings can be carried over.'
                : 'Its old settings did not say how often, so a schedule has to be chosen.'}
            </p>
            {canEdit && (
              <Button size="sm" onClick={() => startEditing(
                legacySuggestion ? { ...legacySuggestion, is_paused: false } : { ...BLANK, starts_on: today },
              )}>
                Set up a real schedule
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {rule && !editing && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm" data-testid="recurrence-summary">{describeRule(rule)}</p>
            {rule.is_paused && <Badge variant="outline" className="shrink-0">Paused</Badge>}
          </div>

          <p className="text-xs text-muted-foreground">
            {rule.occurrences_created === 0
              ? rule.generation_mode === 'on_completion'
                ? 'Nothing created yet. The next one appears when this task is completed or cancelled.'
                : 'Nothing created yet.'
              : `${rule.occurrences_created} created so far.`}
          </p>

          {occurrences.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs font-medium text-muted-foreground">Already created</p>
              <div className="flex flex-wrap gap-1">
                {occurrences.map((o) => (
                  <Badge
                    key={o.occurrence_date}
                    variant={o.task_id ? 'secondary' : 'outline'}
                    className="text-[10px]"
                    // A ledger row with no task is one whose task was deleted. Saying so beats
                    // hiding it, because it is why that date will never be produced again.
                    title={o.task_id ? undefined : 'This occurrence was created and then deleted.'}
                  >
                    {o.occurrence_date}{!o.task_id && ' (deleted)'}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!rule && !editing && !legacyOrphan && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">This task does not repeat.</p>
          {canEdit && <Button variant="outline" size="sm" onClick={() => startEditing()}>Set a schedule</Button>}
        </div>
      )}

      {editing && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-frequency" className="text-xs">How often</Label>
              <Select
                value={draft.frequency}
                onValueChange={(v: Frequency) => setDraft({
                  ...draft, frequency: v,
                  // Clearing these on a frequency change mirrors the CHECK constraints, which
                  // refuse weekdays on anything but weekly and a month day on anything but monthly.
                  weekdays: v === 'weekly' ? draft.weekdays : null,
                  month_day: v === 'monthly' ? draft.month_day : null,
                })}
              >
                <SelectTrigger id="rec-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-interval" className="text-xs">
                Every N {FREQUENCY_LABELS[draft.frequency].many}
              </Label>
              <Input
                id="rec-interval" type="number" min={1} max={365}
                value={draft.interval_count}
                onChange={(e) => setDraft({ ...draft, interval_count: parseInt(e.target.value, 10) || 1 })}
              />
            </div>
          </div>

          {draft.frequency === 'weekly' && (
            <div className="space-y-1.5">
              <Label className="text-xs">On these days (optional)</Label>
              <div className="flex flex-wrap gap-1">
                {WEEKDAY_LABELS.map((label, value) => {
                  const active = draft.weekdays?.includes(value) ?? false
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        const next = active
                          ? (draft.weekdays ?? []).filter((d) => d !== value)
                          : [...(draft.weekdays ?? []), value]
                        // An empty array is refused by the CHECK - it is a rule that can never
                        // fire - so deselecting the last day means "no weekday restriction".
                        setDraft({ ...draft, weekdays: next.length > 0 ? next : null })
                      }}
                      className={`rounded-md border px-2 py-1 text-xs ${active ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {draft.frequency === 'monthly' && (
            <div className="space-y-1.5">
              <Label htmlFor="rec-monthday" className="text-xs">Day of the month (optional)</Label>
              <Input
                id="rec-monthday" type="number" min={1} max={31}
                value={draft.month_day ?? ''}
                placeholder="Same day as the start date"
                onChange={(e) => setDraft({ ...draft, month_day: e.target.value ? parseInt(e.target.value, 10) : null })}
              />
              {draft.month_day && draft.month_day > 28 && (
                <p className="text-xs text-muted-foreground">
                  Months without a {draft.month_day}th use their last day instead.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rec-mode" className="text-xs">When to create the next one</Label>
            <Select
              value={draft.generation_mode}
              onValueChange={(v: GenerationMode) => setDraft({ ...draft, generation_mode: v })}
            >
              <SelectTrigger id="rec-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GENERATION_MODES.map((m) => (
                  <SelectItem key={m} value={m}>{GENERATION_MODE_LABELS[m].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{GENERATION_MODE_LABELS[draft.generation_mode].hint}</p>
          </div>

          {draft.generation_mode === 'schedule' && (
            <div className="space-y-1.5">
              <Label htmlFor="rec-horizon" className="text-xs">Create this far ahead (days)</Label>
              <Input
                id="rec-horizon" type="number" min={1} max={365}
                value={draft.horizon_days}
                onChange={(e) => setDraft({ ...draft, horizon_days: parseInt(e.target.value, 10) || 30 })}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rec-start" className="text-xs">Starts on</Label>
              <Input
                id="rec-start" type="date" value={draft.starts_on}
                onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rec-end" className="text-xs">Ends on (optional)</Label>
              <Input
                id="rec-end" type="date" value={draft.ends_on ?? ''}
                onChange={(e) => setDraft({ ...draft, ends_on: e.target.value || null })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-max" className="text-xs">Stop after this many (optional)</Label>
            <Input
              id="rec-max" type="number" min={1} max={1000}
              value={draft.max_occurrences ?? ''}
              placeholder="No limit"
              onChange={(e) => setDraft({ ...draft, max_occurrences: e.target.value ? parseInt(e.target.value, 10) : null })}
            />
          </div>

          {/* The preview only appears for schedule mode. An on_completion rule's next date
              depends on when a human finishes the current one, so listing five confident dates
              for it would be a lie about how it behaves. */}
          {preview.length > 0 && (
            <div className="rounded-md bg-muted/40 p-2" data-testid="recurrence-preview">
              <p className="text-xs font-medium text-muted-foreground">Next few</p>
              <p className="text-xs">{preview.join(' · ')}</p>
            </div>
          )}

          {rejection && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{rejection}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={saving || Boolean(rejection)}>
              {saving ? 'Saving...' : rule ? 'Update schedule' : 'Create schedule'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
