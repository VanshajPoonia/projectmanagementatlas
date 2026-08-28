'use client'

// Create or edit one sprint/cycle/iteration.
//
// Every noun on this form comes from the board's `terminology` setting, so a contracting or
// marketing board that switches agile on never has the word "sprint" put in front of it.

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  sprintNoun, sprintNounTitle, type EstimateUnit, type Terminology,
} from '@/lib/agile'
import type { SprintDraft, SprintRow } from '@/lib/agile-data'

const UNASSIGNED = '__none__'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  term: Terminology
  unit: EstimateUnit
  users: { id: string; full_name?: string | null; email?: string | null }[]
  /** Null for a new one. */
  sprint: SprintRow | null
  today: string
  busy?: boolean
  onSave: (draft: SprintDraft) => void
}

export function SprintDialog({ open, onOpenChange, term, unit, users, sprint, today, busy, onSave }: Props) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [owner, setOwner] = useState<string>(UNASSIGNED)
  const [capacity, setCapacity] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(sprint?.title ?? '')
    setGoal(sprint?.goal ?? '')
    // ⚠️ These are DATE columns, so they are read and written as plain `YYYY-MM-DD` strings
    // and never round-tripped through a Date. That round trip is what has put the wrong day
    // in this database five times.
    setStart(sprint?.start_date ?? today)
    setEnd(sprint?.end_date ?? today)
    setOwner(sprint?.owner_id ?? UNASSIGNED)
    setCapacity(sprint?.capacity !== null && sprint?.capacity !== undefined ? String(Number(sprint.capacity)) : '')
  }, [open, sprint, today])

  const trimmed = title.trim()
  const datesOk = Boolean(start && end && end >= start)
  const capacityNum = capacity.trim() === '' ? null : Number(capacity)
  const capacityOk = capacityNum === null || (Number.isFinite(capacityNum) && capacityNum > 0)
  const canSave = trimmed.length > 0 && datesOk && capacityOk && !busy

  const noun = sprintNoun(term)
  const closed = sprint?.state === 'completed' || sprint?.state === 'cancelled'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sprint ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
          <DialogDescription>
            {closed
              ? `This ${noun} has closed. Its dates are fixed, because every number recorded for it is scoped to that window.`
              : `A named window of work on this board. Nothing changes for anyone until you start it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sprint-title">{sprintNounTitle(term)} name</Label>
            <Input
              id="sprint-title" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. ${sprintNounTitle(term)} 14`} maxLength={200} autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sprint-goal">Goal <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              id="sprint-goal" value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="What is this window for? One sentence the team can hold in their head."
              rows={2} maxLength={2000}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-start">Starts</Label>
              <Input id="sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={closed} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sprint-end">Ends</Label>
              <Input id="sprint-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={closed} />
            </div>
          </div>
          {!datesOk && (
            <p className="text-destructive text-xs">
              The end date has to be on or after the start date.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sprint-owner">Owner</Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger id="sprint-owner"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>No owner</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email || 'Unnamed'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sprint-capacity">Capacity <span className="text-muted-foreground font-normal">({unit}, optional)</span></Label>
              <Input
                id="sprint-capacity" type="number" min="0" step="0.5" value={capacity}
                onChange={(e) => setCapacity(e.target.value)} placeholder="Leave blank for none"
              />
              <p className="text-muted-foreground text-xs">
                Leave it blank rather than entering 0 &mdash; zero would put every {noun} over capacity from its first item.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!canSave}
            onClick={() => onSave({
              title: trimmed,
              goal: goal.trim() || null,
              start_date: start,
              end_date: end,
              owner_id: owner === UNASSIGNED ? null : owner,
              capacity: capacityOk ? capacityNum : null,
            })}
          >
            {busy ? 'Saving…' : sprint ? 'Save' : `Create ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
