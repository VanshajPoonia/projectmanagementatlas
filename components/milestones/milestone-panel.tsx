'use client'

// MILESTONES - Prompt I's "milestones first", the object a timeline is drawn against.
//
// ⚠️ TWO THINGS THIS PANEL REFUSES TO DO, BOTH DELIBERATE.
//
// 1. It never shows a single blended "milestone progress" figure. What it shows is EXECUTION
//    progress - how much of the linked work is closed - labelled as exactly that, because
//    Prompt H's rule (a project can complete all its tasks and still fail its outcome) applies
//    to a dated commitment just as much as to a goal. `lib/milestones.ts` has no function that
//    returns a blended number, so this component could not render one if it wanted to.
//
// 2. It never marks a milestone missed because its date passed. Being late is derived and shown
//    as pressure ("5 days overdue"); being MISSED is a decision a person makes, and it costs a
//    written reason. That is 130's rejected-versus-parked distinction: six months on, the reason
//    is the only record of why the date moved, and a status the system applied on its own has no
//    reason attached to it at all.
//
// The reason requirement is mirrored from migration 133's trigger through
// `stateChangeRejection`, so the Save button DISABLES with an explanation rather than sending a
// write the database will refuse. Both halves are pinned against each other by
// lib/milestones.parity.test.ts and scripts/check-milestones.mjs - 104's lesson is that a rule
// living in only one of the two places is a rule the other one does not have.

import { useMemo, useState } from 'react'
import { CalendarDays, Diamond, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { calendarDateLabel } from '@/lib/calendar-grid'
import { cn } from '@/lib/utils'
import {
  MILESTONE_STATES, MILESTONE_STATE_HINTS, MILESTONE_STATE_LABELS,
  explainProgress, milestoneProgress, milestoneState, milestoneStatus,
  noteAfterTransition, sortMilestones, stateChangeRejection, suggestsReached,
  type MilestoneRow, type MilestoneState, type MilestoneTaskRow,
} from '@/lib/milestones'
import type { GoalTaskRow } from '@/lib/goals'
import type { StatusCatalog } from '@/lib/task-status'

export interface MilestoneDraftState {
  title: string
  description: string
  due_date: string
  owner_id: string | null
  state: MilestoneState
  state_note: string
}

interface MilestonePanelProps {
  milestones: MilestoneRow[]
  links: MilestoneTaskRow[]
  tasksById: Map<string, GoalTaskRow>
  statuses: StatusCatalog
  users: { id: string; full_name?: string | null; email?: string | null }[]
  boardTitles: Map<string, string>
  today: string
  canManage: boolean
  /** The single board a new milestone would go on, or null when the scope is not one board. */
  createBoardId: string | null
  createBlockedReason: string | null
  onCreate: (draft: MilestoneDraftState, boardId: string) => Promise<boolean>
  onUpdate: (id: string, draft: MilestoneDraftState, previous: MilestoneRow) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

const PRESSURE_TONE: Record<string, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  due_today: 'text-amber-600 dark:text-amber-400',
  due_soon: 'text-amber-600 dark:text-amber-400',
  upcoming: 'text-muted-foreground',
  reached: 'text-emerald-600 dark:text-emerald-400',
  missed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-muted-foreground',
}

const emptyDraft = (today: string): MilestoneDraftState => ({
  title: '',
  description: '',
  due_date: today,
  owner_id: null,
  state: 'open',
  state_note: '',
})

export function MilestonePanel({
  milestones, links, tasksById, statuses, users, boardTitles, today,
  canManage, createBoardId, createBlockedReason, onCreate, onUpdate, onDelete,
}: MilestonePanelProps) {
  const [editing, setEditing] = useState<MilestoneRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<MilestoneDraftState>(() => emptyDraft(today))
  const [saving, setSaving] = useState(false)

  const linksByMilestone = useMemo(() => {
    const out = new Map<string, MilestoneTaskRow[]>()
    for (const link of links) {
      out.set(link.milestone_id, [...(out.get(link.milestone_id) ?? []), link])
    }
    return out
  }, [links])

  const ordered = useMemo(() => sortMilestones(milestones), [milestones])

  const openCreate = () => {
    setDraft(emptyDraft(today))
    setEditing(null)
    setCreating(true)
  }

  const openEdit = (milestone: MilestoneRow) => {
    setDraft({
      title: milestone.title,
      description: milestone.description ?? '',
      due_date: milestone.due_date,
      owner_id: milestone.owner_id ?? null,
      state: milestoneState(milestone),
      state_note: milestone.state_note ?? '',
    })
    setCreating(false)
    setEditing(milestone)
  }

  const closeDialog = () => {
    setCreating(false)
    setEditing(null)
  }

  // The trigger's own rule, asked before the write rather than discovered by it.
  const rejection = editing
    ? stateChangeRejection(milestoneState(editing), draft.state, draft.state_note)
    : stateChangeRejection('open', draft.state, draft.state_note)
  const titleMissing = draft.title.trim() === ''
  const dateMissing = draft.due_date.trim() === ''
  const blocked = rejection !== null || titleMissing || dateMissing

  const save = async () => {
    if (blocked) return
    setSaving(true)
    const normalized: MilestoneDraftState = {
      ...draft,
      title: draft.title.trim(),
      // Keeps the dialog and the trigger agreeing about what survives a transition, so the
      // form never shows a reason the database is about to throw away.
      state_note: noteAfterTransition(draft.state, draft.state_note) ?? '',
    }
    const ok = editing
      ? await onUpdate(editing.id, normalized, editing)
      : createBoardId
        ? await onCreate(normalized, createBoardId)
        : false
    setSaving(false)
    if (ok) closeDialog()
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Diamond className="text-muted-foreground h-4 w-4" />
        <h3 className="text-sm font-medium">Milestones</h3>
        <Badge variant="secondary" className="h-5">{ordered.length}</Badge>
        <div className="ml-auto">
          {canManage && (
            <Button
              type="button"
              id="milestone-create"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!createBoardId}
              title={createBoardId ? undefined : createBlockedReason ?? undefined}
              onClick={openCreate}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New milestone
            </Button>
          )}
        </div>
      </div>

      {/* A control that is off must say why, rather than looking broken. */}
      {canManage && !createBoardId && createBlockedReason && (
        <p className="text-muted-foreground border-b px-3 py-2 text-xs">{createBlockedReason}</p>
      )}

      {ordered.length === 0 ? (
        <p className="text-muted-foreground p-4 text-center text-xs">
          No milestones on the boards in view. That is not the same as none existing: a private
          board&apos;s milestones are simply not returned to someone who is not a member.
        </p>
      ) : (
        <ul className="divide-y">
          {ordered.map((milestone) => {
            const status = milestoneStatus(milestone, today)
            const progress = milestoneProgress(
              linksByMilestone.get(milestone.id) ?? [],
              tasksById,
              statuses,
            )
            const owner = users.find((u) => u.id === milestone.owner_id)
            return (
              <li
                key={milestone.id}
                data-milestone={milestone.id}
                className="hover:bg-muted/30 flex items-start gap-3 px-3 py-2.5"
              >
                <Diamond
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    status.pressure === 'overdue' || status.pressure === 'missed'
                      ? 'fill-red-500 text-red-600'
                      : status.state === 'reached'
                        ? 'fill-emerald-500 text-emerald-600'
                        : status.state === 'cancelled'
                          ? 'fill-muted text-muted-foreground'
                          : 'fill-primary text-primary',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{milestone.title}</span>
                    <Badge variant="outline" className="h-5 text-[10px]">
                      {MILESTONE_STATE_LABELS[status.state]}
                    </Badge>
                    {boardTitles.get(milestone.board_id) && (
                      <span className="text-muted-foreground text-[11px]">
                        {boardTitles.get(milestone.board_id)}
                      </span>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {calendarDateLabel(milestone.due_date)}
                    </span>
                    <span className={PRESSURE_TONE[status.pressure] ?? ''} data-pressure={status.pressure}>
                      {status.label}
                    </span>
                    {owner && <span>{owner.full_name || owner.email}</span>}
                  </div>

                  {/* ⚠️ Labelled "work complete", never just "progress". The word matters: it is
                      the only thing on screen saying this is execution and not outcome. */}
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="bg-muted h-1.5 w-28 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full transition-all"
                        style={{ width: `${progress.percent ?? 0}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-[11px]" data-progress={milestone.id}>
                      {progress.percent === null
                        ? 'Nothing linked'
                        : `${progress.percent}% of linked work complete`}
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[11px]">
                    {explainProgress(progress)}
                  </p>

                  {milestone.state_note && (
                    <p className="text-muted-foreground mt-1 text-[11px] italic">
                      Reason: {milestone.state_note}
                    </p>
                  )}

                  {suggestsReached(milestone, progress) && canManage && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                      <TriangleAlert className="h-3 w-3" />
                      Every linked item is closed. Marking it reached is still your call.
                    </p>
                  )}
                </div>

                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      data-milestone-edit={milestone.id}
                      aria-label={`Edit ${milestone.title}`}
                      onClick={() => openEdit(milestone)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 w-7 p-0"
                      data-milestone-delete={milestone.id}
                      aria-label={`Delete ${milestone.title}`}
                      onClick={() => onDelete(milestone.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={creating || editing !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit milestone' : 'New milestone'}</DialogTitle>
            <DialogDescription>
              A dated commitment this project is judged against. Progress comes from the work
              linked to it and is never entered by hand.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="milestone-title">Title</Label>
              <Input
                id="milestone-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Permit issued"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="milestone-due">Due date</Label>
              <Input
                id="milestone-due"
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="milestone-owner">Owner</Label>
              <Select
                value={draft.owner_id ?? '__none__'}
                onValueChange={(v) => setDraft({ ...draft, owner_id: v === '__none__' ? null : v })}
              >
                <SelectTrigger id="milestone-owner"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nobody yet</SelectItem>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name || user.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-[11px]">
                The owner can record this milestone as reached without being an admin, because
                keeping a date current is the most frequent thing anyone does to it.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="milestone-description">Description</Label>
              <Textarea
                id="milestone-description"
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            {editing && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="milestone-state">State</Label>
                  <Select
                    value={draft.state}
                    onValueChange={(v) => setDraft({ ...draft, state: v as MilestoneState })}
                  >
                    <SelectTrigger id="milestone-state"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MILESTONE_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {MILESTONE_STATE_LABELS[state]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-[11px]">
                    {MILESTONE_STATE_HINTS[draft.state]}
                  </p>
                </div>

                {(draft.state === 'missed' || draft.state === 'cancelled') && (
                  <div className="space-y-1.5">
                    <Label htmlFor="milestone-note">Reason</Label>
                    <Textarea
                      id="milestone-note"
                      rows={2}
                      value={draft.state_note}
                      onChange={(e) => setDraft({ ...draft, state_note: e.target.value })}
                      placeholder="The permit office pushed the review by three weeks."
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {blocked && (
              <p className="text-muted-foreground mr-auto text-xs" data-milestone-blocked>
                {rejection ?? (titleMissing ? 'A milestone needs a title.' : 'A milestone needs a due date.')}
              </p>
            )}
            <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button type="button" id="milestone-save" disabled={blocked || saving} onClick={save}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
