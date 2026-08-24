'use client'

// Quick capture: one line in, one task out, with the parse always on screen.
//
// The design constraint from Prompt D is "never silently discard user text", and the way this
// screen honours it is that the interpretation is never hidden. Every span the parser consumed
// is drawn as a chip under the input, naming the field and the ABSOLUTE value it resolved to -
// "tomorrow -> Tuesday, 25 August 2026", not just a calendar icon. A wrong guess is therefore
// visible before saving rather than discovered a week later when nobody shows up.
//
// Chips are removable. Dismissing one puts its text back into the title, which is the honest
// inverse of consuming it: the words return to where they came from rather than vanishing.
//
// The Paste-a-list tab shares the same parser per line, so a pasted line behaves exactly as it
// would typed here. Indentation is analysed and REPORTED, never acted on silently - see
// lib/multi-create.ts's header for why.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { AlertTriangle, CalendarDays, Clock, Flag, Hash, Loader2, Repeat, User, X, Zap } from 'lucide-react'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { statusesForCreation, findExactColumnForStatus } from '@/lib/task-status'
import { logTaskActivity } from '@/lib/task-activity'
import {
  parseQuickCapture,
  captureDueTimestamp,
  PRIORITY_LABELS,
  type CaptureField,
  type CaptureMatch,
  type ParsedCapture,
} from '@/lib/quick-capture'
import { parseMultiCreate, summarizePlan, type MultiCreatePlan } from '@/lib/multi-create'
import { todayInBusinessZone } from '@/lib/recurrence'
import { cn } from '@/lib/utils'

const FIELD_ICONS: Record<CaptureField, typeof CalendarDays> = {
  date: CalendarDays,
  time: Clock,
  priority: Flag,
  assignee: User,
  label: Hash,
  recurrence: Repeat,
}

/** How many pasted lines are drawn in the preview. Creation itself is uncapped - see below. */
const PREVIEW_ROWS = 200

const FIELD_NAMES: Record<CaptureField, string> = {
  date: 'Due', time: 'At', priority: 'Priority', assignee: 'Assignee', label: 'Label', recurrence: 'Repeats',
}

interface QuickCaptureDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  boardId: string
  columns: any[]
  users: any[]
  onCreated?: () => void
}

/** The chip row. This is the whole "show your working" contract, so it is deliberately loud. */
function MatchChips({
  matches,
  onRemove,
}: {
  matches: CaptureMatch[]
  onRemove: (m: CaptureMatch) => void
}) {
  if (matches.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="capture-chips">
      {[...matches].sort((a, b) => a.start - b.start).map((m) => {
        const Icon = FIELD_ICONS[m.field]
        return (
          <span
            key={`${m.field}-${m.start}`}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 py-1 pl-2 pr-1 text-xs"
            data-field={m.field}
          >
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">{FIELD_NAMES[m.field]}</span>
            {/* The absolute value, never just the phrase the user typed. */}
            <span className="font-medium">{m.display ?? String(m.value)}</span>
            <button
              type="button"
              onClick={() => onRemove(m)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-background"
              aria-label={`Undo ${FIELD_NAMES[m.field]} ${m.display ?? m.value} and put "${m.text}" back in the title`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )
      })}
    </div>
  )
}

export default function QuickCaptureDialog({
  open, onOpenChange, boardId, columns, users, onCreated,
}: QuickCaptureDialogProps) {
  const [mode, setMode] = useState<'single' | 'list'>('single')
  const [text, setText] = useState('')
  const [listText, setListText] = useState('')
  const [useHierarchy, setUseHierarchy] = useState(false)
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  /** Matches the user explicitly rejected, keyed by field+offset, so they stay rejected. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()
  const taskStatuses = useTaskStatuses()
  const [allTags, setAllTags] = useState<any[]>([])

  const creatable = useMemo(() => statusesForCreation(taskStatuses), [taskStatuses])

  useEffect(() => {
    if (!open) return
    setDismissed(new Set())
    setProgress(null)
    // Default to the first status a new task can hold, so the common path needs no choice.
    if (!status && creatable.length > 0) setStatus(creatable[0].key)
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [open, creatable, status])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    supabase.from('tags').select('id, name').then(({ data }: { data: any[] | null }) => {
      if (!cancelled) setAllTags(data ?? [])
    })
    return () => { cancelled = true }
  }, [open, supabase])

  const people = useMemo(
    () => users.map((u: any) => ({ id: u.id, name: u.full_name || u.email || '' })).filter((p) => p.name),
    [users],
  )
  const labels = useMemo(() => allTags.map((t: any) => ({ id: t.id, name: t.name })), [allTags])
  const today = todayInBusinessZone()

  const parsed: ParsedCapture = useMemo(() => {
    const raw = parseQuickCapture(text, { today, people, labels })
    if (dismissed.size === 0) return raw
    // A dismissed chip means the user said "that word is part of my title". Re-derive the
    // title from the surviving matches rather than patching it, so the invariant that
    // title === input minus matches still holds exactly.
    const kept = raw.matches.filter((m) => !dismissed.has(`${m.field}:${m.start}`))
    return rebuild(text, raw, kept)
  }, [text, today, people, labels, dismissed])

  const plan: MultiCreatePlan = useMemo(
    () => parseMultiCreate(listText, { today, people, labels }),
    [listText, today, people, labels],
  )

  const counts = summarizePlan(plan, useHierarchy && plan.hierarchy.confidence !== 'none')
  const canSaveSingle = parsed.title.trim().length > 0 && Boolean(status)
  const canSaveList = counts.total > 0 && Boolean(status)

  async function createOne(
    item: {
      title: string; dueDate: string | null; dueTime: string | null
      priority: number | null; assignees: string[]; labels: string[]
      recurrence?: ParsedCapture['recurrence']
    },
    parentId: string | null,
    userId: string,
  ): Promise<string | null> {
    const statusDef = creatable.find((s) => s.key === status)
    const targetColumn = findExactColumnForStatus(status, statusDef?.label ?? '', columns)
    if (!targetColumn) {
      throw new Error(`No column on this board is linked to "${statusDef?.label ?? status}". Ask an admin to link one.`)
    }

    const due = captureDueTimestamp({ ...item, matches: [], warnings: [], recurrence: null } as ParsedCapture)
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: item.title,
        column_id: targetColumn.id,
        created_by: userId,
        assigned_to: item.assignees[0] ?? null,
        // Priority is required on the full create dialog; quick capture defaults it to Medium
        // rather than blocking the fast path on a field most captures do not mention.
        priority: item.priority ?? 3,
        due_date: due,
        status,
        position: targetColumn.tasks?.filter((t: any) => !t.deleted_at && !t.archived_at).length ?? 0,
        visibility: 'assigned',
        parent_task_id: parentId,
        type_key: parentId ? 'subtask' : 'task',
      })
      .select('id')
      .single()

    if (error) throw error
    const taskId = data.id as string

    if (item.assignees.length > 0) {
      await supabase.from('task_assignees').insert(item.assignees.map((user_id) => ({ task_id: taskId, user_id })))
    }
    if (item.labels.length > 0) {
      await supabase.from('task_tags').insert(item.labels.map((tag_id) => ({ task_id: taskId, tag_id })))
    }
    // "Standup every monday" shows a Repeats chip, so it has to produce a real schedule.
    // Parsing a recurrence and then dropping it would be exactly the defect migration 116 was
    // written to end: a control that confirms a repeat and creates nothing. Subtasks are
    // excluded because 060 gives them no independent lifecycle to repeat on.
    if (item.recurrence && !parentId) {
      const { error: ruleError } = await supabase.from('recurrence_rules').insert({
        source_task_id: taskId,
        frequency: item.recurrence.frequency,
        interval_count: item.recurrence.interval,
        weekdays: item.recurrence.frequency === 'weekly' ? item.recurrence.weekdays : null,
        // on_completion, matching 116's backfill: one live instance at a time is what a
        // repeating chore means, and it cannot flood a board on the first sweep.
        generation_mode: 'on_completion',
        starts_on: item.dueDate ?? todayInBusinessZone(),
        created_by: userId,
      })
      // The task is already created and is the useful half. A schedule that failed is worth
      // saying out loud rather than silently dropping, but it must not read as "nothing saved".
      if (ruleError) {
        toast.warning('Task created, but the repeat was not', { description: ruleError.message })
      }
    }

    logTaskActivity(supabase, taskId, userId, 'created this task from quick capture')
    return taskId
  }

  async function handleSaveSingle() {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('You are not signed in.')
      await createOne(parsed, null, user.id)
      toast.success('Task created', { description: parsed.title })
      setText('')
      setDismissed(new Set())
      onCreated?.()
      inputRef.current?.focus()
    } catch (err: any) {
      toast.error('Could not create that task', { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveList() {
    setSaving(true)
    const nest = useHierarchy && plan.hierarchy.confidence !== 'none'
    const creatables = plan.items.filter((i) => i.parsed.title.trim())
    setProgress({ done: 0, total: creatables.length })

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('You are not signed in.')

      // Parents first, so a child always has a real id to point at. The map is keyed by the
      // item's index in `plan.items`, which is what parentIndex refers to.
      const created = new Map<number, string>()
      const failures: string[] = []
      let done = 0

      for (const item of plan.items) {
        if (!item.parsed.title.trim()) continue
        const parentId = nest && item.parentIndex !== null ? created.get(item.parentIndex) ?? null : null
        try {
          const id = await createOne(item.parsed, parentId, user.id)
          if (id) created.set(plan.items.indexOf(item), id)
        } catch (err: any) {
          // One bad line must not abandon the rest, and the user must be told which failed.
          failures.push(`Line ${item.lineNumber}: ${err?.message ?? 'failed'}`)
        }
        done++
        setProgress({ done, total: creatables.length })
      }

      if (failures.length > 0) {
        toast.error(`${created.size} of ${creatables.length} created`, {
          description: failures.slice(0, 3).join(' · '),
          duration: 10000,
        })
      } else {
        toast.success(`${created.size} ${created.size === 1 ? 'task' : 'tasks'} created`)
        setListText('')
      }
      onCreated?.()
    } catch (err: any) {
      toast.error('Could not create these tasks', { description: err?.message })
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" aria-hidden />
            Quick capture
          </DialogTitle>
          <DialogDescription>
            Type naturally. Dates, times, priority, people and labels are picked out as you go, and
            everything they mean is shown below before you save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist">
          {(['single', 'list'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'single' ? 'One task' : 'Paste a list'}
            </button>
          ))}
        </div>

        {mode === 'single' ? (
          <div className="space-y-3">
            <Input
              ref={inputRef}
              id="quick-capture-input"
              value={text}
              onChange={(e) => { setText(e.target.value); setDismissed(new Set()) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSaveSingle && !saving) { e.preventDefault(); handleSaveSingle() }
              }}
              placeholder="Prepare bid package tomorrow 3pm high priority @Bobby #Atlas"
              className="text-base"
              autoComplete="off"
            />

            <MatchChips
              matches={parsed.matches}
              onRemove={(m) => setDismissed((prev) => new Set(prev).add(`${m.field}:${m.start}`))}
            />

            {/* The title, restated. Without this the user cannot see what survived parsing. */}
            {text.trim().length > 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Title: </span>
                {parsed.title ? (
                  <span className="font-medium" data-testid="capture-title">{parsed.title}</span>
                ) : (
                  <span className="italic text-muted-foreground">nothing left - every word was read as a field</span>
                )}
              </div>
            )}

            {parsed.warnings.length > 0 && (
              <Alert data-testid="capture-warnings">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="space-y-1">
                    {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              placeholder={'Prepare proposal\nCall client\nSend estimate'}
              rows={8}
              className="font-mono text-sm"
            />

            {plan.items.length > 0 && (
              <>
                {plan.hierarchy.confidence !== 'none' && (
                  <div className={cn(
                    'space-y-2 rounded-md border px-3 py-2 text-sm',
                    plan.hierarchy.confidence === 'ambiguous' ? 'border-amber-500/50 bg-amber-500/5' : 'bg-muted/30',
                  )}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        id="use-hierarchy"
                        checked={useHierarchy}
                        onChange={(e) => setUseHierarchy(e.target.checked)}
                        className="mt-0.5 h-4 w-4 cursor-pointer rounded border-input"
                      />
                      <div className="space-y-1">
                        <Label htmlFor="use-hierarchy" className="cursor-pointer font-medium">
                          Make indented lines subtasks
                        </Label>
                        {/* Off by default even when the nesting looks clear: acting on
                            indentation the user did not intend is tedious to undo card by card. */}
                        <p className="text-xs text-muted-foreground">{plan.hierarchy.reason}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2" data-testid="capture-preview">
                  {/* There is no cap on how many tasks may be CREATED - a big paste is a
                      legitimate thing to do. There is a cap on how many are DRAWN, because a
                      thousand rows of live React inside a dialog makes the whole thing stutter
                      while you type. The count above always states the real total. */}
                  {plan.items.slice(0, PREVIEW_ROWS).map((item, i) => {
                    const nested = useHierarchy && plan.hierarchy.confidence !== 'none' && item.parentIndex !== null
                    return (
                      <div
                        key={i}
                        className={cn('flex items-center gap-2 rounded px-2 py-1 text-sm', nested && 'ml-6')}
                      >
                        <span className={cn('truncate', !item.parsed.title.trim() && 'italic text-muted-foreground')}>
                          {item.parsed.title.trim() || '(no title - will be skipped)'}
                        </span>
                        {item.duplicateOf !== null && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">duplicate</Badge>
                        )}
                        {item.parsed.matches.map((m) => (
                          <Badge key={`${m.field}-${m.start}`} variant="secondary" className="shrink-0 text-[10px]">
                            {m.display ?? String(m.value)}
                          </Badge>
                        ))}
                      </div>
                    )
                  })}
                  {plan.items.length > PREVIEW_ROWS && (
                    <p className="px-2 py-1 text-xs italic text-muted-foreground">
                      ...and {plan.items.length - PREVIEW_ROWS} more, all of which will be created.
                    </p>
                  )}
                </div>

                <p className="text-sm text-muted-foreground" data-testid="capture-count">
                  {counts.total} {counts.total === 1 ? 'task' : 'tasks'} will be created
                  {counts.subtasks > 0 && ` (${counts.topLevel} top level, ${counts.subtasks} as subtasks)`}
                  {plan.skipped > 0 && `, ${plan.skipped} empty ${plan.skipped === 1 ? 'line' : 'lines'} ignored`}.
                </p>
              </>
            )}

            {plan.warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="space-y-1">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <Label htmlFor="quick-capture-status" className="text-xs text-muted-foreground">Create in</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="quick-capture-status" className="w-48">
                <SelectValue placeholder="Pick a status" />
              </SelectTrigger>
              <SelectContent>
                {creatable.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button
              onClick={mode === 'single' ? handleSaveSingle : handleSaveList}
              disabled={saving || (mode === 'single' ? !canSaveSingle : !canSaveList)}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {progress
                ? `Creating ${progress.done} of ${progress.total}...`
                : mode === 'single' ? 'Create task' : `Create ${counts.total || ''} ${counts.total === 1 ? 'task' : 'tasks'}`.trim()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Re-derive a parse after the user dismissed some chips.
 *
 * Recomputing the title from the surviving matches (rather than string-patching it) keeps the
 * invariant lib/quick-capture.test.ts asserts: the title is exactly the input minus the spans
 * that were consumed. Field values are cleared for whichever fields no longer have a match, so
 * dismissing the date chip really does leave the task with no due date.
 */
function rebuild(input: string, raw: ParsedCapture, kept: CaptureMatch[]): ParsedCapture {
  const has = (f: CaptureField) => kept.some((m) => m.field === f)
  const valuesFor = (f: CaptureField) => kept.filter((m) => m.field === f).map((m) => String(m.value))

  let title = input
  const sorted = [...kept].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const m of sorted) {
    if (m.start < cursor) continue
    out += input.slice(cursor, m.start)
    cursor = m.end
  }
  out += input.slice(cursor)
  title = out.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()

  return {
    ...raw,
    title,
    matches: kept,
    dueDate: has('date') ? raw.dueDate : null,
    dueTime: has('time') ? raw.dueTime : null,
    priority: has('priority') ? raw.priority : null,
    assignees: valuesFor('assignee'),
    labels: valuesFor('label'),
    recurrence: has('recurrence') ? raw.recurrence : null,
    // Warnings about text that was never consumed still apply; ones about a dismissed field
    // do not, but keeping them is the safe direction - a stale warning is noise, a missing
    // one is a silent guess.
    warnings: raw.warnings,
  }
}
