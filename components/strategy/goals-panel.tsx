'use client'

// Goals: the outcome the organisation is chasing, and the work connected to it.
//
// ⚠️ Every write here classifies its result through lib/rls-write.ts, because an RLS refusal
// returns zero rows and NO error. `report()` below is the one place that interpretation lives.
//
// ⚠️ A measurement note travels in the SAME statement as the numbers. Migration 129's ledger is
// not application-writable - a second write afterwards is precisely the design that table
// refuses - so `checkin_note` is a write-only carrier that never comes back.

import { useCallback, useMemo, useState } from 'react'
import { Link2, Plus, Target, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shell/states'
import { createClient } from '@/lib/supabase/client'
import type { CategorizedStatus } from '@/lib/task-status'
import {
  executionProgress, goalWindow, outcomeProgress, requiresCheckin, sortGoals, isGoalOpen, num, formatMeasure,
  GOAL_CONFIDENCE_LABELS, GOAL_HEALTH_LABELS, GOAL_HEALTH_IS_MANUAL, GOAL_STATE_LABELS, GOAL_STATES,
  type GoalCheckinRow, type GoalLinkRow, type GoalRow, type GoalTaskRow, type GoalState,
} from '@/lib/goals'
import {
  createGoal, deleteGoal, didWrite, linkGoal, unlinkGoal, updateGoal, writeFailureMessage,
  type GoalDraft, type StrategyWrite,
} from '@/lib/strategy-data'
import { ProgressPair } from './progress-pair'
import type { BoardOption, PersonRow } from './strategy-workspace'

function report(outcome: StrategyWrite['outcome'], subject: string): boolean {
  const failure = writeFailureMessage(outcome, subject)
  if (failure) toast.error(failure.title, { description: failure.description })
  return didWrite(outcome)
}

const EMPTY_DRAFT: GoalDraft = {
  title: '', description: null, owner_id: null, starts_on: null, ends_on: null,
  metric: null, unit: null, start_value: null, current_value: null, target_value: null,
  confidence: null, health: null,
}

/** A Select cannot hold an empty string as a value, so absence needs a sentinel. */
const NONE = '__none__'

export function GoalsPanel({
  userId, isAdmin, goals: initialGoals, links: initialLinks, checkins: initialCheckins,
  tasks, statuses, users, boards, boardTitles, today,
}: {
  userId: string | null
  isAdmin: boolean
  goals: GoalRow[]
  links: GoalLinkRow[]
  checkins: GoalCheckinRow[]
  tasks: (GoalTaskRow & { board_id: string | null })[]
  statuses: CategorizedStatus[]
  users: PersonRow[]
  boards: BoardOption[]
  boardTitles: Map<string, string>
  today: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [goals, setGoals] = useState(initialGoals)
  const [links, setLinks] = useState(initialLinks)
  const [checkins] = useState(initialCheckins)
  const [busy, setBusy] = useState(false)

  const [editing, setEditing] = useState<{ open: boolean; goal: GoalRow | null }>({ open: false, goal: null })
  const [draft, setDraft] = useState<GoalDraft>(EMPTY_DRAFT)
  const [measuring, setMeasuring] = useState<GoalRow | null>(null)
  const [measurement, setMeasurement] = useState({ value: '', confidence: NONE, health: NONE, note: '' })
  const [linking, setLinking] = useState<GoalRow | null>(null)

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks])
  const peopleById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name || u.email || 'Someone'])), [users])
  const ordered = useMemo(() => sortGoals(goals), [goals])

  const linksFor = useCallback((goalId: string) => links.filter((l) => l.goal_id === goalId), [links])

  const openCreate = () => { setDraft(EMPTY_DRAFT); setEditing({ open: true, goal: null }) }
  const openEdit = (goal: GoalRow) => {
    setDraft({
      title: goal.title,
      description: goal.description ?? null,
      owner_id: goal.owner_id ?? null,
      starts_on: goal.starts_on ?? null,
      ends_on: goal.ends_on ?? null,
      metric: goal.metric ?? null,
      unit: goal.unit ?? null,
      start_value: num(goal.start_value),
      current_value: num(goal.current_value),
      target_value: num(goal.target_value),
      confidence: goal.confidence ?? null,
      health: goal.health ?? null,
    })
    setEditing({ open: true, goal })
  }

  const saveGoal = async () => {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      if (editing.goal) {
        // ⚠️ current_value / confidence / health are deliberately NOT sent from this dialog.
        // Migration 129 requires a note to accompany a change to any of them, and the honest
        // place to change a measurement is the measurement dialog, which asks for one. Sending
        // them here would produce a refusal the user could not explain.
        const { current_value, confidence, health, ...rest } = draft
        const res = await updateGoal(supabase, editing.goal.id, rest)
        if (!report(res.outcome, 'goal')) return
        if (res.goal) setGoals((prev) => prev.map((g) => (g.id === res.goal!.id ? res.goal! : g)))
      } else {
        const res = await createGoal(supabase, draft, userId)
        if (!report(res.outcome, 'goal')) return
        if (res.goal) setGoals((prev) => [...prev, res.goal!])
      }
      setEditing({ open: false, goal: null })
    } finally {
      setBusy(false)
    }
  }

  const openMeasure = (goal: GoalRow) => {
    setMeasurement({
      value: num(goal.current_value)?.toString() ?? '',
      confidence: goal.confidence ?? NONE,
      health: goal.health ?? NONE,
      note: '',
    })
    setMeasuring(goal)
  }

  const saveMeasurement = async () => {
    if (!measuring) return
    const patch: Partial<GoalDraft> = {}
    const value = measurement.value.trim() === '' ? null : Number(measurement.value)
    if (value !== null && !Number.isFinite(value)) {
      toast.error('That is not a number', { description: 'Enter the current value as a plain number, or leave it blank.' })
      return
    }
    patch.current_value = value
    patch.confidence = measurement.confidence === NONE ? null : (measurement.confidence as GoalRow['confidence'])
    patch.health = measurement.health === NONE ? null : (measurement.health as GoalRow['health'])

    // ⚠️ Migration 129's trigger REFUSES a note that accompanies no measurable change, so
    // without this the user gets a raw check_violation for typing a sentence into a form that
    // asked for one. `requiresCheckin` mirrors that trigger and says so; explaining why the
    // action is unavailable is Prompt B's rule, and it beats a refusal nobody can interpret.
    if (!requiresCheckin(measuring, patch) && measurement.note.trim()) {
      toast.error('Nothing measurable changed', {
        description: 'A note records what moved. Change the value, health or confidence as well, or leave the note blank.',
      })
      return
    }

    setBusy(true)
    try {
      const res = await updateGoal(supabase, measuring.id, patch, measurement.note)
      if (!report(res.outcome, 'measurement')) return
      if (res.goal) setGoals((prev) => prev.map((g) => (g.id === res.goal!.id ? res.goal! : g)))
      setMeasuring(null)
      toast.success('Measurement recorded', { description: 'The previous reading is kept in this goal\'s history.' })
    } finally {
      setBusy(false)
    }
  }

  const setState = async (goal: GoalRow, state: GoalState) => {
    setBusy(true)
    try {
      const res = await updateGoal(supabase, goal.id, { state })
      if (!report(res.outcome, 'goal')) return
      if (res.goal) setGoals((prev) => prev.map((g) => (g.id === res.goal!.id ? res.goal! : g)))
    } finally {
      setBusy(false)
    }
  }

  const removeGoal = async (goal: GoalRow) => {
    setBusy(true)
    try {
      const res = await deleteGoal(supabase, goal.id)
      if (!report(res.outcome, 'goal')) return
      setGoals((prev) => prev.filter((g) => g.id !== goal.id))
      setLinks((prev) => prev.filter((l) => l.goal_id !== goal.id))
    } finally {
      setBusy(false)
    }
  }

  const addLink = async (goal: GoalRow, end: { board_id?: string; task_id?: string }) => {
    setBusy(true)
    try {
      const res = await linkGoal(supabase, goal.id, end, userId)
      if (!report(res.outcome, 'link')) return
      if (res.link) setLinks((prev) => [...prev, res.link!])
    } finally {
      setBusy(false)
    }
  }

  const removeLink = async (linkId: string) => {
    setBusy(true)
    try {
      const res = await unlinkGoal(supabase, linkId)
      if (!report(res.outcome, 'link')) return
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground text-sm">
          {ordered.filter(isGoalOpen).length} active, {ordered.length} in total.
        </p>
        {isAdmin && (
          <Button size="sm" className="ml-auto" onClick={openCreate} id="goal-new">
            <Plus className="mr-1 h-4 w-4" /> New goal
          </Button>
        )}
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          icon={<Target />}
          title="No goals yet"
          description={
            isAdmin
              ? 'A goal is something you want to be true, with a measurement attached. Every goal shows two separate figures: how much of the linked work is done, and how far the number has actually moved.'
              : 'An admin can add the first one. Goals show how much linked work is finished and, separately, whether the number you care about has moved.'
          }
          action={isAdmin ? <Button size="sm" onClick={openCreate} id="goal-new-empty">Add the first goal</Button> : undefined}
        />
      ) : (
        <div className="space-y-4" id="goal-list">
          {ordered.map((goal) => {
            const goalLinks = linksFor(goal.id)
            const execution = executionProgress(goalLinks, tasksById, statuses)
            const outcome = outcomeProgress(goal, checkins)
            const window = goalWindow(goal, today)
            const canEdit = isAdmin || goal.owner_id === userId
            const goalHistory = checkins.filter((c) => c.goal_id === goal.id).slice().reverse()

            return (
              <Card key={goal.id} data-goal-id={goal.id}>
                <CardHeader className="gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <CardTitle className="text-base">{goal.title}</CardTitle>
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span>{goal.owner_id ? peopleById.get(goal.owner_id) ?? 'Someone' : 'No owner'}</span>
                        <span>{window.label}</span>
                        {window.daysRemaining !== null && (
                          <span className={window.isOverdue ? 'text-amber-600 dark:text-amber-400' : undefined}>
                            {window.isOverdue
                              ? `${Math.abs(window.daysRemaining)} day${Math.abs(window.daysRemaining) === 1 ? '' : 's'} past its date`
                              : `${window.daysRemaining} day${window.daysRemaining === 1 ? '' : 's'} left`}
                          </span>
                        )}
                        {goal.metric && <span>Measuring: {goal.metric}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {goal.health && (
                        <Badge variant={goal.health === 'on_track' ? 'secondary' : 'outline'} title={GOAL_HEALTH_IS_MANUAL}>
                          {GOAL_HEALTH_LABELS[goal.health]}
                        </Badge>
                      )}
                      {goal.confidence && (
                        <Badge variant="outline">{GOAL_CONFIDENCE_LABELS[goal.confidence]}</Badge>
                      )}
                      {!isGoalOpen(goal) && (
                        <Badge variant="outline">{GOAL_STATE_LABELS[(goal.state ?? 'active') as GoalState]}</Badge>
                      )}
                    </div>
                  </div>
                  {goal.description && <p className="text-muted-foreground text-sm">{goal.description}</p>}
                </CardHeader>

                <CardContent className="space-y-4">
                  <ProgressPair execution={execution} outcome={outcome} id={`goal-progress-${goal.id}`} />

                  {goalLinks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium">Linked to</p>
                      <ul className="flex flex-wrap gap-1.5">
                        {goalLinks.map((link) => {
                          // ⚠️ A board or task this viewer cannot see was filtered by RLS, not
                          // deleted. It is named as unavailable rather than dropped, so the
                          // list never reads as complete when it is not.
                          const label = link.board_id
                            ? boardTitles.get(link.board_id) ?? 'A project you cannot see'
                            : tasksById.get(link.task_id as string)?.title ?? 'A work item you cannot see'
                          return (
                            // ⚠️ `max-w-full` and a wrapping label, because a Badge is
                            // inline-flex and does not wrap: a long work-item title made this
                            // 352px wide inside a 320px viewport, which widened the whole
                            // column and pushed the TAB STRIP off the page with it. Measured,
                            // not guessed - the tabs looked like the culprit and were not.
                            <li key={link.id} className="min-w-0 max-w-full">
                              <Badge variant="outline" className="max-w-full gap-1 font-normal">
                                <span className="min-w-0 break-words whitespace-normal">
                                  {link.board_id ? 'Project' : 'Work'}: {label}
                                </span>
                                {canEdit && (
                                  // ⚠️ px-1.5 rather than a bare icon: scripts/audit-mobile.mjs
                                  // measured this at 12px wide on a phone. The global
                                  // (pointer: coarse) rule gives it 44px of HEIGHT and says
                                  // nothing about width, and this control destroys a link.
                                  <button
                                    type="button"
                                    onClick={() => removeLink(link.id)}
                                    disabled={busy}
                                    aria-label={`Unlink ${label}`}
                                    className="hover:text-destructive -mr-1.5 ml-0.5 px-1.5"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </Badge>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}

                  {goalHistory.length > 0 && (
                    <details className="text-sm">
                      <summary className="text-muted-foreground cursor-pointer text-xs">
                        History ({goalHistory.length} measurement{goalHistory.length === 1 ? '' : 's'})
                      </summary>
                      <ul className="mt-2 space-y-1.5">
                        {goalHistory.map((c) => (
                          <li key={c.id} className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
                            <span className="text-foreground tabular-nums">{c.on_date}</span>
                            {' - '}
                            {c.kind === 'opened' ? 'Started at ' : 'Measured at '}
                            <span className="text-foreground">{formatMeasure(num(c.current_value), goal.unit ?? null)}</span>
                            {c.health && ` (${GOAL_HEALTH_LABELS[c.health]})`}
                            {c.note && <> - {c.note}</>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => openMeasure(goal)} disabled={busy} id={`goal-measure-${goal.id}`}>
                        Record a measurement
                      </Button>
                    )}
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => setLinking(goal)} disabled={busy} id={`goal-link-${goal.id}`}>
                        <Link2 className="mr-1 h-4 w-4" /> Link work
                      </Button>
                    )}
                    {isAdmin && (
                      <Button size="sm" variant="ghost" onClick={() => openEdit(goal)} disabled={busy}>Edit</Button>
                    )}
                    {isAdmin && (
                      <Select value={(goal.state ?? 'active') as string} onValueChange={(v) => setState(goal, v as GoalState)}>
                        <SelectTrigger className="h-8 w-[9.5rem]" id={`goal-state-${goal.id}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {GOAL_STATES.map((s) => (
                            <SelectItem key={s} value={s}>{GOAL_STATE_LABELS[s]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive ml-auto"
                        onClick={() => removeGoal(goal)}
                        disabled={busy}
                        aria-label={`Delete ${goal.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create / edit */}
      <Dialog open={editing.open} onOpenChange={(open) => setEditing({ open, goal: open ? editing.goal : null })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing.goal ? 'Edit goal' : 'New goal'}</DialogTitle>
            <DialogDescription>
              Only the title is required. A goal with no measurement is still a goal - leave the
              numbers blank and it will say so rather than showing a percentage it does not have.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-title">Title</Label>
              <Input id="goal-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Cut callbacks to 4 a month" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-description">What does reaching it look like?</Label>
              <Textarea id="goal-description" rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value || null })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-owner">Owner</Label>
                <Select value={draft.owner_id ?? NONE} onValueChange={(v) => setDraft({ ...draft, owner_id: v === NONE ? null : v })}>
                  <SelectTrigger id="goal-owner"><SelectValue placeholder="Nobody yet" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nobody yet</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">The owner can update the number without needing an admin.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-metric">What are you measuring?</Label>
                <Input id="goal-metric" value={draft.metric ?? ''} onChange={(e) => setDraft({ ...draft, metric: e.target.value || null })} placeholder="Callbacks per month" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-start">Starts</Label>
                <Input id="goal-start" type="date" value={draft.starts_on ?? ''} onChange={(e) => setDraft({ ...draft, starts_on: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-end">Ends</Label>
                <Input id="goal-end" type="date" value={draft.ends_on ?? ''} onChange={(e) => setDraft({ ...draft, ends_on: e.target.value || null })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="goal-unit">Unit</Label>
                <Input id="goal-unit" value={draft.unit ?? ''} onChange={(e) => setDraft({ ...draft, unit: e.target.value || null })} placeholder="%" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="goal-start-value">From</Label>
                <Input id="goal-start-value" inputMode="decimal" value={draft.start_value ?? ''} onChange={(e) => setDraft({ ...draft, start_value: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              {!editing.goal && (
                <div className="space-y-1.5">
                  <Label htmlFor="goal-current-value">Now</Label>
                  <Input id="goal-current-value" inputMode="decimal" value={draft.current_value ?? ''} onChange={(e) => setDraft({ ...draft, current_value: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="goal-target-value">To</Label>
                <Input id="goal-target-value" inputMode="decimal" value={draft.target_value ?? ''} onChange={(e) => setDraft({ ...draft, target_value: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
            </div>
            {editing.goal && (
              <p className="text-muted-foreground text-xs">
                The current value, confidence and health are changed with "Record a measurement",
                which asks what changed. Every reading is kept.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              The target can be lower than the starting value - "cut callbacks from 12 to 4"
              works exactly the same way.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing({ open: false, goal: null })}>Cancel</Button>
            <Button onClick={saveGoal} disabled={busy || !draft.title.trim()} id="goal-save">
              {editing.goal ? 'Save' : 'Create goal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Measurement */}
      <Dialog open={Boolean(measuring)} onOpenChange={(open) => !open && setMeasuring(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record a measurement</DialogTitle>
            <DialogDescription>
              The previous reading is kept. Nothing here is overwritten, and the record cannot be
              edited afterwards by anyone.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="measure-value">Current value{measuring?.unit ? ` (${measuring.unit})` : ''}</Label>
              <Input id="measure-value" inputMode="decimal" value={measurement.value} onChange={(e) => setMeasurement({ ...measurement, value: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="measure-health">Health</Label>
                <Select value={measurement.health} onValueChange={(v) => setMeasurement({ ...measurement, health: v })}>
                  <SelectTrigger id="measure-health"><SelectValue placeholder="Not said" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not said</SelectItem>
                    <SelectItem value="on_track">On track</SelectItem>
                    <SelectItem value="at_risk">At risk</SelectItem>
                    <SelectItem value="off_track">Off track</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="measure-confidence">Confidence</Label>
                <Select value={measurement.confidence} onValueChange={(v) => setMeasurement({ ...measurement, confidence: v })}>
                  <SelectTrigger id="measure-confidence"><SelectValue placeholder="Not said" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not said</SelectItem>
                    <SelectItem value="high">Confident</SelectItem>
                    <SelectItem value="medium">Unsure</SelectItem>
                    <SelectItem value="low">Doubtful</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-muted-foreground text-xs">{GOAL_HEALTH_IS_MANUAL}</p>
            <div className="space-y-1.5">
              <Label htmlFor="measure-note">What changed?</Label>
              <Textarea id="measure-note" rows={2} value={measurement.note} onChange={(e) => setMeasurement({ ...measurement, note: e.target.value })} placeholder="Two of the three sites switched over." />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setMeasuring(null)}>Cancel</Button>
            <Button onClick={saveMeasurement} disabled={busy} id="measure-save">Record it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Linking */}
      <Dialog open={Boolean(linking)} onOpenChange={(open) => !open && setLinking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link work to this goal</DialogTitle>
            <DialogDescription>
              Linked work items are what "Work done" counts. Linking a whole project records the
              connection but does not count its tasks - link the items that are actually meant to
              move the number.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-board">Add a project</Label>
              <Select value="" onValueChange={(v) => linking && addLink(linking, { board_id: v })}>
                <SelectTrigger id="link-board"><SelectValue placeholder="Pick a project" /></SelectTrigger>
                <SelectContent>
                  {boards
                    .filter((b) => !links.some((l) => l.goal_id === linking?.id && l.board_id === b.id))
                    .map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-task">Add a work item</Label>
              <Select value="" onValueChange={(v) => linking && addLink(linking, { task_id: v })}>
                <SelectTrigger id="link-task"><SelectValue placeholder="Pick a work item" /></SelectTrigger>
                <SelectContent>
                  {tasks
                    .filter((t) => !links.some((l) => l.goal_id === linking?.id && l.task_id === t.id))
                    .slice(0, 200)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}{t.board_id ? ` - ${boardTitles.get(t.board_id) ?? ''}` : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {tasks.length > 200 && (
                <p className="text-muted-foreground text-xs">
                  Showing the first 200 of {tasks.length}. Link from a work item's own page when
                  what you want is not here.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinking(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
