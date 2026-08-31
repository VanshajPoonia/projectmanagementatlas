'use client'

// Decisions waiting on the owner.
//
// ⚠️ This started life as docs/product/open-owner-decisions.md and had that file's defect: a
// hand-maintained copy of a state nobody is obliged to update. The day somebody resolves a
// decision the file still says "waiting on you", and there is no way to tell a live decision
// from a stale sentence. Same reasoning that made app_modules a table rather than a constant.
//
// Every write asks for its rows back and classifies the result, because an RLS refusal returns
// zero rows and no error - a green toast over a write that did not land is the failure mode
// this codebase has shipped more than once.

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState } from '@/components/shell/states'
import { createClient } from '@/lib/supabase/client'
import { classifyWrite, didWrite, writeFailureMessage } from '@/lib/rls-write'
import {
  DECISION_STATUS_HELP, DECISION_STATUS_LABEL, closedDecisions, closureRejectionReason,
  decisionRejectionReason, openDecisions, type DecisionStatus, type OwnerDecision,
} from '@/lib/owner-decisions'

const SELECT = 'id, title, summary, detail, recommendation, status, resolution_note, resolved_by, resolved_at, position, created_at'

export function DecisionManagement({ userId }: { userId?: string }) {
  const supabase = createClient()
  const [rows, setRows] = useState<OwnerDecision[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const [closing, setClosing] = useState<{ decision: OwnerDecision; status: DecisionStatus } | null>(null)
  const [note, setNote] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: '', summary: '', detail: '', recommendation: '' })


  /**
   * ⚠️ `writeFailureMessage` returns a title AND a description, deliberately: "that was not
   * saved" alone leaves somebody staring at a screen that still shows their change. Both halves
   * are shown, and the `invisible` outcome is reported as a success because the write DID land.
   */
  function report(outcome: Awaited<ReturnType<typeof classifyWrite>>, subject: string): boolean {
    const failure = writeFailureMessage(outcome, subject)
    if (failure) toast.error(failure.title, { description: failure.description })
    return didWrite(outcome)
  }

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('owner_decisions').select(SELECT)
    if (error) {
      toast.error(`Could not load decisions: ${error.message}`)
      setRows([])
      return
    }
    setRows((data as OwnerDecision[]) ?? [])
  }, [supabase])

  useEffect(() => { void load() }, [load])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function close(decision: OwnerDecision, status: DecisionStatus, resolutionNote: string) {
    const reason = closureRejectionReason(resolutionNote)
    if (reason) { toast.error(reason); return }
    setBusy(true)
    const result = await supabase
      .from('owner_decisions')
      .update({ status, resolution_note: resolutionNote.trim() })
      .eq('id', decision.id)
      .select('id')
    // Closing cannot change who can see the row - every policy here is the same super-admin
    // check - so no visibility probe is needed and zero rows means a genuine refusal.
    const outcome = await classifyWrite(result)
    setBusy(false)
    if (!report(outcome, 'this decision')) return
    toast.success(status === 'resolved' ? 'Marked as decided.' : 'Marked as not doing.')
    setClosing(null); setNote('')
    await load()
  }

  async function reopen(decision: OwnerDecision) {
    setBusy(true)
    // The trigger clears the note, resolver and timestamp, so a reopened decision never carries
    // an outcome that is no longer true.
    const result = await supabase
      .from('owner_decisions').update({ status: 'open' }).eq('id', decision.id).select('id')
    const outcome = await classifyWrite(result)
    setBusy(false)
    if (!report(outcome, 'this decision')) return
    toast.success('Reopened. Its previous note was cleared.')
    await load()
  }

  async function remove(decision: OwnerDecision) {
    setBusy(true)
    const result = await supabase
      .from('owner_decisions').delete().eq('id', decision.id).select('id')
    const outcome = await classifyWrite(result)
    setBusy(false)
    if (!report(outcome, 'this decision')) return
    toast.success('Deleted.')
    await load()
  }

  async function add() {
    const reason = decisionRejectionReason(draft)
    if (reason) { toast.error(reason); return }
    setBusy(true)
    const result = await supabase.from('owner_decisions').insert({
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      detail: draft.detail.trim() || null,
      recommendation: draft.recommendation.trim() || null,
      created_by: userId ?? null,
      position: 100,
    }).select('id')
    const outcome = await classifyWrite(result)
    setBusy(false)
    if (!report(outcome, 'this decision')) return
    toast.success('Added.')
    setAdding(false)
    setDraft({ title: '', summary: '', detail: '', recommendation: '' })
    await load()
  }

  const open = rows ? openDecisions(rows) : []
  const closed = rows ? closedDecisions(rows) : []

  const card = (d: OwnerDecision) => {
    const isOpen = expanded.has(d.id)
    return (
      <li key={d.id} className="border-t px-4 py-3 first:border-t-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => toggle(d.id)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
            aria-expanded={isOpen}
          >
            <span className="text-muted-foreground mt-0.5" aria-hidden="true">
              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.title}</span>
                <Badge variant={d.status === 'open' ? 'default' : 'secondary'}>
                  {DECISION_STATUS_LABEL[d.status]}
                </Badge>
              </span>
              <span className="text-muted-foreground mt-0.5 block text-sm">{d.summary}</span>
            </span>
          </button>

          <div className="flex shrink-0 flex-wrap gap-2">
            {d.status === 'open' ? (
              <>
                <Button size="sm" disabled={busy}
                  onClick={() => { setClosing({ decision: d, status: 'resolved' }); setNote('') }}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Decided
                </Button>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={() => { setClosing({ decision: d, status: 'dismissed' }); setNote('') }}>
                  <CircleSlash className="mr-1 h-4 w-4" /> Not doing
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void reopen(d)}>
                <RotateCcw className="mr-1 h-4 w-4" /> Reopen
              </Button>
            )}
          </div>
        </div>

        {isOpen && (
          <div className="mt-3 space-y-3 pl-6 text-sm">
            {d.detail && <p className="whitespace-pre-wrap leading-relaxed">{d.detail}</p>}
            {d.recommendation && (
              <div className="bg-muted/50 rounded-md border-l-2 p-3">
                <p className="font-medium">Recommendation</p>
                <p className="text-muted-foreground mt-0.5 leading-relaxed">{d.recommendation}</p>
              </div>
            )}
            {d.status !== 'open' && d.resolution_note && (
              <div className="rounded-md border p-3">
                <p className="font-medium">
                  {DECISION_STATUS_LABEL[d.status]}
                  {d.resolved_at ? ` on ${d.resolved_at.slice(0, 10)}` : ''}
                </p>
                <p className="text-muted-foreground mt-0.5 leading-relaxed">{d.resolution_note}</p>
              </div>
            )}
            <Button size="sm" variant="ghost" disabled={busy}
              className="text-destructive" onClick={() => void remove(d)}>
              <Trash2 className="mr-1 h-4 w-4" /> Delete
            </Button>
          </div>
        )}
      </li>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Decisions</CardTitle>
          <CardDescription>
            Things waiting on a person rather than on code, kept here so they do not get lost in a
            chat log. Only super admins can see this.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} id="decision-add">
          <Plus className="mr-1 h-4 w-4" /> Add
        </Button>
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {rows === null ? (
          <div className="space-y-3 px-4 pb-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 pb-4">
            <EmptyState
              title="Nothing waiting on you"
              description="Decisions recorded here stay visible until somebody closes them with a note."
              action={<Button size="sm" onClick={() => setAdding(true)}>Add the first one</Button>}
            />
          </div>
        ) : (
          <>
            <p className="text-muted-foreground px-4 pb-2 text-xs">
              {open.length === 0
                ? 'Nothing is waiting on you.'
                : `${open.length} waiting on you. ${DECISION_STATUS_HELP.open}`}
            </p>
            <ul id="decision-list">{open.map(card)}</ul>
            {closed.length > 0 && (
              <>
                <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                  Already decided. Kept because the note is the record of why.
                </p>
                <ul id="decision-closed">{closed.map(card)}</ul>
              </>
            )}
          </>
        )}
      </CardContent>

      {/* Closing needs a note, and the database refuses without one. The dialog says so up front
          rather than letting the round-trip fail. */}
      <Dialog open={Boolean(closing)} onOpenChange={(o) => { if (!o) { setClosing(null); setNote('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {closing?.status === 'resolved' ? 'What was decided?' : 'Why is this not being done?'}
            </DialogTitle>
            <DialogDescription>
              {closing?.decision.title}. Six months from now this note is the only record of why.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            id="decision-note"
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={closing?.status === 'resolved'
              ? 'e.g. Turned agile on for the Marketing PM Sheet board first, because its work runs in two-week pushes.'
              : 'e.g. Not worth doing until we have more than one team on this.'}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setClosing(null); setNote('') }}>Cancel</Button>
            <Button
              id="decision-note-save"
              disabled={busy || Boolean(closureRejectionReason(note))}
              onClick={() => closing && void close(closing.decision, closing.status, note)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a decision</DialogTitle>
            <DialogDescription>
              Something that needs a person to choose. Write it so it still makes sense to whoever
              reads it next month.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="decision-title">Title</Label>
              <Input id="decision-title" value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="decision-summary">What is being decided</Label>
              <Input id="decision-summary" value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                placeholder="One sentence." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="decision-detail">Detail (optional)</Label>
              <Textarea id="decision-detail" rows={4} value={draft.detail}
                onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
                placeholder="The facts, the options, and what each one costs." />
            </div>
            <div className="space-y-1">
              <Label htmlFor="decision-recommendation">Recommendation (optional)</Label>
              <Textarea id="decision-recommendation" rows={2} value={draft.recommendation}
                onChange={(e) => setDraft({ ...draft, recommendation: e.target.value })}
                placeholder="Leave blank when there genuinely is not one." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button id="decision-save" disabled={busy || Boolean(decisionRejectionReason(draft))}
              onClick={() => void add()}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
