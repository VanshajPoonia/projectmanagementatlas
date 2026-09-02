'use client'

// The idea pipeline, and the impact/effort view of it.
//
// ⚠️ The matrix has NO storage of its own. Migration 130 already holds `impact` and `effort` on
// every idea, so this is a way of LOOKING at the pipeline rather than a second place things
// live - which is what Prompt H's "do not build a whiteboard engine merely to claim parity"
// asks for, and what stops two judgements about one idea drifting apart.
//
// ⚠️ Converting an idea creates a real task or board and records a POINTER. The idea does not
// move and is not copied, so the reasoning behind a piece of work survives the moment it
// becomes a ticket.

import { useCallback, useMemo, useState } from 'react'
import { Lightbulb, Plus, Trash2 } from 'lucide-react'
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
import { findColumnForStatus, type CategorizedStatus } from '@/lib/task-status'
import {
  IDEA_STATES, IDEA_STATE_HELP, IDEA_STATE_LABELS, IDEA_SCALE_LABELS, MATRIX_CELLS,
  MATRIX_HELP, MATRIX_LABELS, conversionTypes, explainMatrix, ideasByState, impactEffortMatrix,
  isIdeaConverted, isIdeaOpen, requiresRejectionReason,
  type IdeaEventRow, type IdeaNoteRow, type IdeaRow, type IdeaScale, type IdeaState,
} from '@/lib/ideas'
import {
  addIdeaNote, createIdea, createWorkItem, deleteIdea, deleteIdeaNote, didWrite, moveIdea,
  recordConversion, updateIdea, writeFailureMessage, IDEA_EVENT_COLUMNS,
  type IdeaDraft, type StrategyWrite,
} from '@/lib/strategy-data'
import type { BoardOption, ColumnRow, PersonRow } from './strategy-workspace'

function report(outcome: StrategyWrite['outcome'], subject: string): boolean {
  const failure = writeFailureMessage(outcome, subject)
  if (failure) toast.error(failure.title, { description: failure.description })
  return didWrite(outcome)
}

const NONE = '__none__'
const EMPTY: IdeaDraft = {
  title: '', problem: null, target_customer: null, evidence: null, expected_value: null,
  impact: null, effort: null, confidence: null,
}

const SCALES: IdeaScale[] = ['high', 'medium', 'low']

export function IdeasPanel({
  userId, isAdmin, ideas: initialIdeas, events: initialEvents, notes: initialNotes,
  users, boards, columns, statuses, workItemTypes, boardTitles,
}: {
  userId: string | null
  isAdmin: boolean
  ideas: IdeaRow[]
  events: IdeaEventRow[]
  notes: IdeaNoteRow[]
  users: PersonRow[]
  boards: BoardOption[]
  columns: ColumnRow[]
  statuses: CategorizedStatus[]
  workItemTypes: { key: string; name: string; is_active?: boolean | null }[]
  boardTitles: Map<string, string>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [ideas, setIdeas] = useState(initialIdeas)
  const [events, setEvents] = useState(initialEvents)
  const [notes, setNotes] = useState(initialNotes)
  const [busy, setBusy] = useState(false)
  const [lens, setLens] = useState<'pipeline' | 'matrix'>('pipeline')

  const [editing, setEditing] = useState<{ open: boolean; idea: IdeaRow | null }>({ open: false, idea: null })
  const [draft, setDraft] = useState<IdeaDraft>(EMPTY)
  const [detail, setDetail] = useState<IdeaRow | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [rejecting, setRejecting] = useState<{ idea: IdeaRow; reason: string } | null>(null)
  const [converting, setConverting] = useState<{ idea: IdeaRow; kind: 'work' | 'project'; boardId: string; typeKey: string } | null>(null)

  const peopleById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name || u.email || 'Someone'])), [users])
  const grouped = useMemo(() => ideasByState(ideas), [ideas])
  // ⚠️ Derived from the live registry, never hardcoded. Prompt H says a validated idea may
  // become a "project / feature / work item", and `feature` is one of the nine types 113 seeded
  // INACTIVE - so the day a super admin activates it, it appears here with no code change. A
  // hardcoded list would ignore those nine forever.
  const types = useMemo(() => conversionTypes(workItemTypes), [workItemTypes])
  const matrix = useMemo(() => impactEffortMatrix(ideas), [ideas])

  const canMove = useCallback((idea: IdeaRow) => isAdmin || idea.created_by === userId, [isAdmin, userId])

  const refreshIdea = (next: IdeaRow) => setIdeas((prev) => prev.map((i) => (i.id === next.id ? next : i)))

  const openCreate = () => { setDraft(EMPTY); setEditing({ open: true, idea: null }) }

  const openEdit = (idea: IdeaRow) => {
    setDraft({
      title: idea.title, problem: idea.problem ?? null, target_customer: idea.target_customer ?? null,
      evidence: idea.evidence ?? null, expected_value: idea.expected_value ?? null,
      impact: idea.impact ?? null, effort: idea.effort ?? null, confidence: idea.confidence ?? null,
    })
    setEditing({ open: true, idea })
  }

  const save = async () => {
    if (!draft.title.trim()) return
    setBusy(true)
    try {
      if (editing.idea) {
        const res = await updateIdea(supabase, editing.idea.id, draft)
        if (!report(res.outcome, 'idea')) return
        if (res.idea) refreshIdea(res.idea)
      } else {
        const res = await createIdea(supabase, draft, userId)
        if (!report(res.outcome, 'idea')) return
        if (res.idea) setIdeas((prev) => [...prev, res.idea!])
      }
      setEditing({ open: false, idea: null })
    } finally {
      setBusy(false)
    }
  }

  const move = async (idea: IdeaRow, state: IdeaState) => {
    // ⚠️ The dialog does not enforce this; migration 130's trigger does. This check only means
    // the person is asked for the reason instead of being handed a refusal they cannot explain.
    if (requiresRejectionReason(idea.state, state)) {
      setRejecting({ idea, reason: '' })
      return
    }
    setBusy(true)
    try {
      const res = await moveIdea(supabase, idea.id, state)
      if (!report(res.outcome, 'idea')) return
      if (res.idea) { refreshIdea(res.idea); setDetail((d) => (d?.id === res.idea!.id ? res.idea! : d)) }
      await reloadEvents(idea.id)
    } finally {
      setBusy(false)
    }
  }

  const confirmRejection = async () => {
    if (!rejecting || !rejecting.reason.trim()) return
    setBusy(true)
    try {
      const res = await moveIdea(supabase, rejecting.idea.id, 'rejected', rejecting.reason)
      if (!report(res.outcome, 'idea')) return
      if (res.idea) { refreshIdea(res.idea); setDetail((d) => (d?.id === res.idea!.id ? res.idea! : d)) }
      await reloadEvents(rejecting.idea.id)
      setRejecting(null)
    } finally {
      setBusy(false)
    }
  }

  // The history is trigger-written, so the only way to see the new row is to read it back.
  const reloadEvents = async (ideaId: string) => {
    const { data } = await supabase
      .from('idea_events')
      .select(IDEA_EVENT_COLUMNS)
      .eq('idea_id', ideaId)
      .order('created_at')
    if (Array.isArray(data)) {
      setEvents((prev) => [...prev.filter((e) => e.idea_id !== ideaId), ...(data as IdeaEventRow[])])
    }
  }

  const remove = async (idea: IdeaRow) => {
    setBusy(true)
    try {
      const res = await deleteIdea(supabase, idea.id)
      if (!report(res.outcome, 'idea')) return
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id))
      setDetail(null)
    } finally {
      setBusy(false)
    }
  }

  const addNote = async () => {
    if (!detail || !noteDraft.trim()) return
    setBusy(true)
    try {
      const res = await addIdeaNote(supabase, detail.id, noteDraft.trim(), userId)
      if (!report(res.outcome, 'note')) return
      if (res.note) setNotes((prev) => [...prev, res.note!])
      setNoteDraft('')
    } finally {
      setBusy(false)
    }
  }

  const removeNote = async (noteId: string) => {
    setBusy(true)
    try {
      const res = await deleteIdeaNote(supabase, noteId)
      if (!report(res.outcome, 'note')) return
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } finally {
      setBusy(false)
    }
  }

  const convert = async () => {
    if (!converting) return
    setBusy(true)
    try {
      if (converting.kind === 'work') {
        const boardColumns = columns.filter((c) => c.board_id === converting.boardId)
        // ⚠️ Resolve the destination through the status catalog, never by column title. 112's
        // whole point: a board whose "To Do" column was renamed still tracks the status.
        // The first status whose category is `planned` is where new work belongs. Resolved
        // through the catalog rather than a column title (112's whole point: a board whose
        // "To Do" column was renamed still tracks the status), falling back to the board's
        // first column when nothing matches.
        const target = statuses.find((s) => s.category === 'planned' && !(s as any).is_archived)
          ?? statuses.find((s) => !(s as any).is_archived)
        const column = (target
          ? findColumnForStatus(target.key, (target as any).label, boardColumns as any)
          : undefined) ?? boardColumns[0]
        if (!column) {
          toast.error('That project has no columns', { description: 'Add a column to it first, then convert.' })
          return
        }
        const statusKey = (column as any).status_key ?? 'to_do'
        const res = await createWorkItem(supabase, {
          column_id: (column as any).id,
          title: converting.idea.title,
          description: converting.idea.problem ?? null,
          status: statusKey,
          type_key: converting.typeKey,
        }, userId)
        if (!report(res.outcome, 'work item')) return
        if (!res.task) return
        const link = await recordConversion(supabase, converting.idea.id, { converted_task_id: res.task.id })
        if (!report(link.outcome, 'idea')) return
        if (link.idea) refreshIdea(link.idea)
        toast.success('Work item created', { description: 'The idea keeps its research and now links to the work.' })
      } else {
        const link = await recordConversion(supabase, converting.idea.id, { converted_board_id: converting.boardId })
        if (!report(link.outcome, 'idea')) return
        if (link.idea) refreshIdea(link.idea)
        toast.success('Linked to the project', { description: 'The idea keeps its research and now links to the project.' })
      }
      await reloadEvents(converting.idea.id)
      setConverting(null)
    } finally {
      setBusy(false)
    }
  }

  const detailNotes = detail ? notes.filter((n) => n.idea_id === detail.id) : []
  const detailEvents = detail ? events.filter((e) => e.idea_id === detail.id) : []

  const IdeaChip = ({ idea }: { idea: IdeaRow }) => (
    <button
      type="button"
      onClick={() => setDetail(idea)}
      className="hover:bg-accent w-full rounded-md border px-3 py-2 text-left text-sm transition-colors"
      data-idea-id={idea.id}
    >
      <span className="line-clamp-2 font-medium">{idea.title}</span>
      <span className="text-muted-foreground mt-1 flex flex-wrap gap-1.5 text-xs">
        {idea.impact && <span>Impact {IDEA_SCALE_LABELS[idea.impact].toLowerCase()}</span>}
        {idea.effort && <span>Effort {IDEA_SCALE_LABELS[idea.effort].toLowerCase()}</span>}
        {isIdeaConverted(idea) && <span>Became work</span>}
      </span>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={lens} onValueChange={(v) => setLens(v as 'pipeline' | 'matrix')}>
          <SelectTrigger id="idea-lens" className="w-[13rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pipeline">Pipeline</SelectItem>
            <SelectItem value="matrix">Impact and effort</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          {ideas.length} idea{ideas.length === 1 ? '' : 's'}, {ideas.filter(isIdeaOpen).length} still moving.
        </p>
        {/* Anyone signed in may capture one. An idea box gated to admins is a suggestion box
            with a lock on it, and the RLS policy is deliberately just as wide. */}
        <Button size="sm" className="ml-auto" onClick={openCreate} id="idea-new">
          <Plus className="mr-1 h-4 w-4" /> Capture an idea
        </Button>
      </div>

      {ideas.length === 0 ? (
        <EmptyState
          icon={<Lightbulb />}
          title="No ideas captured yet"
          description="Anyone in the workspace can write one down. A title is enough - the problem, the evidence and the expected value can all be filled in later, or never."
          action={<Button size="sm" onClick={openCreate} id="idea-new-empty">Capture the first idea</Button>}
        />
      ) : lens === 'pipeline' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" id="idea-pipeline">
          {IDEA_STATES.map((state) => (
            <section key={state} className="space-y-2" data-state={state}>
              <header className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">{IDEA_STATE_LABELS[state]}</h3>
                  <Badge variant="outline" className="tabular-nums">{grouped[state].length}</Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-snug">{IDEA_STATE_HELP[state]}</p>
              </header>
              <div className="space-y-2">
                {grouped[state].map((idea) => <IdeaChip key={idea.id} idea={idea} />)}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="space-y-3" id="idea-matrix">
          <div className="grid gap-3 md:grid-cols-2">
            {MATRIX_CELLS.map((cell) => (
              <Card key={cell} data-cell={cell}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{MATRIX_LABELS[cell]}</CardTitle>
                  <p className="text-muted-foreground text-xs">{MATRIX_HELP[cell]}</p>
                </CardHeader>
                <CardContent className="space-y-2">
                  {matrix.cells[cell].length === 0
                    ? <p className="text-muted-foreground text-xs">Nothing here.</p>
                    : matrix.cells[cell].map((idea) => <IdeaChip key={idea.id} idea={idea} />)}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ⚠️ Unscored ideas are listed, never placed. Putting an idea in "Time sinks"
              because two fields were blank is an accusation the data does not support. */}
          {matrix.unscored.length > 0 && (
            <Card id="idea-unscored">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Not scored yet ({matrix.unscored.length})</CardTitle>
                <p className="text-muted-foreground text-xs">
                  These have no impact or no effort recorded, so they are not placed in a box.
                </p>
              </CardHeader>
              <CardContent className="space-y-2">
                {matrix.unscored.map((idea) => <IdeaChip key={idea.id} idea={idea} />)}
              </CardContent>
            </Card>
          )}

          <p className="text-muted-foreground text-xs leading-relaxed">{explainMatrix(matrix)}</p>
        </div>
      )}

      {/* Capture / edit */}
      <Dialog open={editing.open} onOpenChange={(open) => setEditing({ open, idea: open ? editing.idea : null })}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing.idea ? 'Edit idea' : 'Capture an idea'}</DialogTitle>
            <DialogDescription>
              Only the title is required. Everything else can be filled in later, when somebody
              actually looks at it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="idea-title">Idea</Label>
              <Input id="idea-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Text clients the day before a site visit" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idea-problem">What problem does it solve?</Label>
              <Textarea id="idea-problem" rows={2} value={draft.problem ?? ''} onChange={(e) => setDraft({ ...draft, problem: e.target.value || null })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="idea-customer">Who is it for?</Label>
                <Input id="idea-customer" value={draft.target_customer ?? ''} onChange={(e) => setDraft({ ...draft, target_customer: e.target.value || null })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="idea-value">What is it worth?</Label>
                <Input id="idea-value" value={draft.expected_value ?? ''} onChange={(e) => setDraft({ ...draft, expected_value: e.target.value || null })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="idea-evidence">Evidence</Label>
              <Textarea id="idea-evidence" rows={2} value={draft.evidence ?? ''} onChange={(e) => setDraft({ ...draft, evidence: e.target.value || null })} placeholder="Three clients asked for this in the last month." />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['impact', 'effort', 'confidence'] as const).map((field) => (
                <div key={field} className="space-y-1.5">
                  <Label htmlFor={`idea-${field}`} className="capitalize">{field}</Label>
                  <Select
                    value={(draft[field] ?? NONE) as string}
                    onValueChange={(v) => setDraft({ ...draft, [field]: v === NONE ? null : (v as IdeaScale) })}
                  >
                    <SelectTrigger id={`idea-${field}`}><SelectValue placeholder="Not scored" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not scored</SelectItem>
                      {SCALES.map((s) => <SelectItem key={s} value={s}>{IDEA_SCALE_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Impact and effort are what place an idea on the four-box grid. Leave them blank and
              it is listed as unscored rather than guessed at.
            </p>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing({ open: false, idea: null })}>Cancel</Button>
            <Button onClick={save} disabled={busy || !draft.title.trim()} id="idea-save">
              {editing.idea ? 'Save' : 'Capture it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Dialog open={Boolean(detail)} onOpenChange={(open) => { if (!open) { setDetail(null); setNoteDraft('') } }}>
        <DialogContent className="sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  {IDEA_STATE_LABELS[detail.state]} - {IDEA_STATE_HELP[detail.state]}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                {detail.problem && <p><span className="font-medium">Problem: </span>{detail.problem}</p>}
                {detail.target_customer && <p><span className="font-medium">For: </span>{detail.target_customer}</p>}
                {detail.expected_value && <p><span className="font-medium">Worth: </span>{detail.expected_value}</p>}
                {detail.evidence && <p><span className="font-medium">Evidence: </span>{detail.evidence}</p>}

                {isIdeaConverted(detail) && (
                  <p className="rounded-md border-l-2 px-3 py-2">
                    This became real work
                    {detail.converted_board_id && ` - the project "${boardTitles.get(detail.converted_board_id) ?? 'you cannot see'}"`}
                    {detail.converted_task_id && ' - a work item on a board'}
                    . The idea stays here with its research.
                  </p>
                )}

                {canMove(detail) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="idea-move" className="text-xs">Move to</Label>
                    <Select value={detail.state} onValueChange={(v) => move(detail, v as IdeaState)}>
                      <SelectTrigger id="idea-move" className="h-8 w-[11rem]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {IDEA_STATES.map((s) => <SelectItem key={s} value={s}>{IDEA_STATE_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {!isIdeaConverted(detail) && (
                      <>
                        <Button size="sm" variant="outline" disabled={busy || boards.length === 0} id="idea-convert-work"
                          onClick={() => setConverting({ idea: detail, kind: 'work', boardId: boards[0]?.id ?? '', typeKey: types[0]?.key ?? 'task' })}>
                          Turn into a work item
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy || boards.length === 0} id="idea-convert-project"
                          onClick={() => setConverting({ idea: detail, kind: 'project', boardId: boards[0]?.id ?? '', typeKey: 'task' })}>
                          Link to a project
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => { openEdit(detail); setDetail(null) }} disabled={busy}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive ml-auto" onClick={() => remove(detail)} disabled={busy} aria-label="Delete idea">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                <section className="space-y-2">
                  <h3 className="text-sm font-medium">Research ({detailNotes.length})</h3>
                  {detailNotes.length === 0 && <p className="text-muted-foreground text-xs">Nothing recorded yet.</p>}
                  <ul className="space-y-2">
                    {detailNotes.map((note) => (
                      <li key={note.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap">{note.body}</p>
                          <p className="text-muted-foreground mt-0.5 text-xs">
                            {note.created_by ? peopleById.get(note.created_by) ?? 'Someone' : 'Someone who has left'}
                          </p>
                        </div>
                        {(isAdmin || note.created_by === userId) && (
                          <button type="button" onClick={() => removeNote(note.id)} disabled={busy}
                            className="text-muted-foreground hover:text-destructive" aria-label="Delete note">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Textarea id="idea-note" rows={2} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="What did you find out?" />
                    <Button size="sm" onClick={addNote} disabled={busy || !noteDraft.trim()} id="idea-note-save">Add</Button>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-medium">History</h3>
                  <ul className="space-y-1">
                    {detailEvents.map((event) => (
                      <li key={event.id} className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">
                        <span className="text-foreground">
                          {event.kind === 'captured' ? 'Captured' : event.kind === 'converted' ? 'Converted' : `Moved to ${IDEA_STATE_LABELS[event.to_state as IdeaState] ?? event.to_state}`}
                        </span>
                        {' by '}{event.created_by ? peopleById.get(event.created_by) ?? 'someone' : 'someone who has left'}
                        {event.note && <> - {event.note}</>}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground text-xs">
                    This record cannot be edited or deleted by anyone, including admins.
                  </p>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Rejection needs a reason - migration 130 refuses it otherwise */}
      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Why are we not doing this?</DialogTitle>
            <DialogDescription>
              In six months this reason is the only thing stopping the same idea being raised
              again from scratch. It is kept permanently and cannot be edited afterwards.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            id="idea-reject-reason"
            rows={3}
            value={rejecting?.reason ?? ''}
            onChange={(e) => rejecting && setRejecting({ ...rejecting, reason: e.target.value })}
            placeholder="Already covered by the client portal work."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button onClick={confirmRejection} disabled={busy || !rejecting?.reason.trim()} id="idea-reject-save">
              Reject it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversion */}
      <Dialog open={Boolean(converting)} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {converting?.kind === 'work' ? 'Turn this into a work item' : 'Link this to a project'}
            </DialogTitle>
            <DialogDescription>
              {converting?.kind === 'work'
                ? 'A normal task is created on the board you pick. The idea stays here with all its research and gains a link to it.'
                : 'The idea is recorded as having become this project. Nothing about the project changes.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="convert-board">Project</Label>
              <Select value={converting?.boardId ?? ''} onValueChange={(v) => converting && setConverting({ ...converting, boardId: v })}>
                <SelectTrigger id="convert-board"><SelectValue placeholder="Pick a project" /></SelectTrigger>
                <SelectContent>
                  {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Only when there is a real choice. One active type means one option, and a picker
                offering a single value is a control that asks a question with no answer. */}
            {converting?.kind === 'work' && types.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="convert-type">Kind of work item</Label>
                <Select value={converting.typeKey} onValueChange={(v) => setConverting({ ...converting, typeKey: v })}>
                  <SelectTrigger id="convert-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {types.map((t) => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConverting(null)}>Cancel</Button>
            <Button onClick={convert} disabled={busy || !converting?.boardId} id="convert-save">
              {converting?.kind === 'work' ? 'Create the work item' : 'Link it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
