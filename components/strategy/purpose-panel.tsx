'use client'

// What a project is for. Eight optional boxes, and none of them is required to create a board.
//
// Prompt H: "Do not require these fields to create a board." So this is a separate screen
// rather than a step in board creation, every field is nullable in the schema, and a board
// with no purpose row is the normal case rather than an incomplete one.

import { useEffect, useMemo, useState } from 'react'
import { Compass } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/shell/states'
import { createClient } from '@/lib/supabase/client'
import { didWrite, saveBoardPurpose, writeFailureMessage, type BoardPurposeRow, type StrategyWrite } from '@/lib/strategy-data'
import type { BoardOption } from './strategy-workspace'

function report(outcome: StrategyWrite['outcome'], subject: string): boolean {
  const failure = writeFailureMessage(outcome, subject)
  if (failure) toast.error(failure.title, { description: failure.description })
  return didWrite(outcome)
}

type Field = keyof Omit<BoardPurposeRow, 'board_id' | 'updated_at' | 'updated_by'>

/**
 * The eight fields Prompt H lists, each with the question it is actually asking. A heading
 * like "Constraints" on its own is answered with a platitude; the question under it is the
 * difference between a purpose people fill in and one they skip.
 */
const FIELDS: { key: Field; label: string; help: string; placeholder: string }[] = [
  { key: 'problem_statement', label: 'The problem', help: 'What is wrong today that this project exists to fix?', placeholder: 'Site visits are booked by phone and half of them are not written down anywhere.' },
  { key: 'purpose', label: 'Purpose', help: 'Why are we doing this, in one or two sentences?', placeholder: '' },
  { key: 'intended_outcome', label: 'Intended outcome', help: 'What is different once this has worked?', placeholder: '' },
  { key: 'success_criteria', label: 'Success looks like', help: 'How will you know? Name something you could check.', placeholder: '' },
  { key: 'target_customer', label: 'Who it is for', help: 'Whose life gets better - a client, a crew, a team?', placeholder: '' },
  { key: 'stakeholders', label: 'Stakeholders', help: 'Who needs to be kept informed, and who signs off?', placeholder: '' },
  { key: 'constraints', label: 'Constraints', help: 'Budget, dates, people, anything fixed that cannot move.', placeholder: '' },
  { key: 'non_goals', label: 'Not doing', help: 'What is explicitly out of scope? This is the one people skip and the one that later prevents the most argument.', placeholder: 'We are not redesigning the website as part of this.' },
]

export function PurposePanel({
  userId, isAdmin, boards, purposes: initialPurposes,
}: {
  userId: string | null
  isAdmin: boolean
  boards: BoardOption[]
  purposes: BoardPurposeRow[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [purposes, setPurposes] = useState(initialPurposes)
  const [boardId, setBoardId] = useState<string>(boards[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const current = useMemo(() => purposes.find((p) => p.board_id === boardId) ?? null, [purposes, boardId])
  const [draft, setDraft] = useState<Record<Field, string>>(() => blank())

  function blank(): Record<Field, string> {
    return FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: '' }), {} as Record<Field, string>)
  }

  // Reload the form whenever the selected board changes. Without this the previous board's
  // text sits in the boxes and the next Save writes it onto the wrong project.
  useEffect(() => {
    const next = blank()
    for (const field of FIELDS) next[field.key] = (current?.[field.key] as string | null) ?? ''
    setDraft(next)
  }, [boardId, current])

  const dirty = FIELDS.some((f) => draft[f.key] !== ((current?.[f.key] as string | null) ?? ''))
  const filled = FIELDS.filter((f) => (current?.[f.key] as string | null)?.trim()).length

  const save = async () => {
    if (!boardId) return
    setBusy(true)
    try {
      const patch = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: draft[f.key].trim() || null }), {})
      const res = await saveBoardPurpose(supabase, boardId, patch, userId)
      if (!report(res.outcome, 'purpose')) return
      if (res.purpose) {
        setPurposes((prev) => {
          const without = prev.filter((p) => p.board_id !== boardId)
          return [...without, res.purpose!]
        })
      }
      toast.success('Saved')
    } finally {
      setBusy(false)
    }
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon={<Compass />}
        title="No projects you can see"
        description="A purpose describes a project, so this needs at least one board you have access to."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={boardId} onValueChange={setBoardId}>
          <SelectTrigger id="purpose-board" className="w-[18rem]"><SelectValue placeholder="Pick a project" /></SelectTrigger>
          <SelectContent>
            {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          {filled === 0 ? 'Nothing written yet.' : `${filled} of ${FIELDS.length} filled in.`}
        </p>
        {isAdmin && (
          <Button size="sm" className="ml-auto" onClick={save} disabled={busy || !dirty} id="purpose-save">
            Save
          </Button>
        )}
      </div>

      {!isAdmin && (
        <p className="text-muted-foreground text-sm">
          An admin can write this. Everyone can read it.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {FIELDS.map((field) => {
          const value = draft[field.key]
          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`purpose-${field.key}`}>{field.label}</Label>
              <p className="text-muted-foreground text-xs leading-snug">{field.help}</p>
              {isAdmin ? (
                <Textarea
                  id={`purpose-${field.key}`}
                  rows={3}
                  value={value}
                  placeholder={field.placeholder}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                />
              ) : (
                <p className="rounded-md border px-3 py-2 text-sm whitespace-pre-wrap" id={`purpose-${field.key}`}>
                  {value || <span className="text-muted-foreground">Not written.</span>}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        Every one of these is optional. A project with none of them filled in is a perfectly
        normal project - nothing on any board asks for this or waits on it.
      </p>
    </div>
  )
}
