'use client'

// SWOT. Four lists, written for the whole company or for one project.
//
// ⚠️ Deliberately not a diagram. Prompt H: "Do not build a whiteboard engine merely to claim
// parity." There are no coordinates in migration 131 and none here - a SWOT is four lists, and
// drawing it adds an engine and no information. Migration 131's header records which of the
// four candidate canvases were built and which were refused, and why.

import { useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import {
  SWOT_BUCKETS, SWOT_LABELS, SWOT_ORIGIN, SWOT_PROMPTS, itemsForScope, itemsInBucket, scopeLabel,
  type StrategyItemRow, type SwotBucket,
} from '@/lib/strategy'
import {
  addCanvasItem, deleteCanvasItem, didWrite, updateCanvasItem, writeFailureMessage,
  type StrategyWrite,
} from '@/lib/strategy-data'
import type { BoardOption } from './strategy-workspace'

function report(outcome: StrategyWrite['outcome'], subject: string): boolean {
  const failure = writeFailureMessage(outcome, subject)
  if (failure) toast.error(failure.title, { description: failure.description })
  return didWrite(outcome)
}

/** board_id NULL means the whole organisation, so the picker needs a sentinel for it. */
const ORG = '__org__'

export function SwotPanel({
  userId, isAdmin, items: initialItems, boards,
}: {
  userId: string | null
  isAdmin: boolean
  items: StrategyItemRow[]
  boards: BoardOption[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState(initialItems)
  const [scope, setScope] = useState<string>(ORG)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const boardId = scope === ORG ? null : scope
  const scoped = useMemo(() => itemsForScope(items, boardId), [items, boardId])

  const add = async (bucket: SwotBucket) => {
    const body = (drafts[bucket] ?? '').trim()
    if (!body) return
    setBusy(true)
    try {
      const res = await addCanvasItem(supabase, { board_id: boardId }, bucket, body, userId)
      if (!report(res.outcome, 'entry')) return
      if (res.item) setItems((prev) => [...prev, res.item!])
      setDrafts({ ...drafts, [bucket]: '' })
    } finally {
      setBusy(false)
    }
  }

  // ⚠️ Editing existed in lib/strategy-data.ts with no button, which is this repo's
  // most-repeated defect in miniature. Without it a typo in a SWOT entry means delete and
  // retype, losing who wrote it and when.
  const saveEdit = async () => {
    if (!editing || !editing.body.trim()) return
    setBusy(true)
    try {
      const res = await updateCanvasItem(supabase, editing.id, editing.body.trim())
      if (!report(res.outcome, 'entry')) return
      if (res.item) setItems((prev) => prev.map((i) => (i.id === res.item!.id ? res.item! : i)))
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (itemId: string) => {
    setBusy(true)
    try {
      const res = await deleteCanvasItem(supabase, itemId)
      if (!report(res.outcome, 'entry')) return
      setItems((prev) => prev.filter((i) => i.id !== itemId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger id="swot-scope" className="w-[18rem]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ORG}>Whole organisation</SelectItem>
            {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">
          {scoped.length} entr{scoped.length === 1 ? 'y' : 'ies'} for{' '}
          {scopeLabel(boardId, boards.find((b) => b.id === boardId)?.title)}.
        </p>
      </div>

      {!isAdmin && (
        <p className="text-muted-foreground text-sm">An admin can write this. Everyone can read it.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2" id="swot-grid">
        {SWOT_BUCKETS.map((bucket) => {
          const entries = itemsInBucket(scoped, bucket)
          return (
            <Card key={bucket} data-bucket={bucket}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{SWOT_LABELS[bucket]}</CardTitle>
                  {/* Internal versus external is the axis that makes the grid mean anything -
                      the first two are about you, the last two are not. */}
                  <span className="text-muted-foreground text-xs capitalize">{SWOT_ORIGIN[bucket]}</span>
                </div>
                <p className="text-muted-foreground text-xs leading-snug">{SWOT_PROMPTS[bucket]}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {entries.length === 0 && <p className="text-muted-foreground text-xs">Nothing here yet.</p>}
                <ul className="space-y-1.5">
                  {entries.map((item) => (
                    <li key={item.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                      {editing?.id === item.id ? (
                        <>
                          <Input
                            id={`swot-edit-${item.id}`}
                            value={editing.body}
                            autoFocus
                            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveEdit() }
                              if (e.key === 'Escape') { e.preventDefault(); setEditing(null) }
                            }}
                          />
                          <Button size="sm" variant="outline" onClick={saveEdit} disabled={busy || !editing.body.trim()}>
                            Save
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 break-words">{item.body}</span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setEditing({ id: item.id, body: item.body })}
                              disabled={busy}
                              className="text-muted-foreground hover:text-foreground"
                              aria-label={`Edit "${item.body}"`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => remove(item.id)}
                              disabled={busy}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label={`Remove "${item.body}"`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {isAdmin && (
                  <div className="flex gap-2">
                    <Input
                      id={`swot-input-${bucket}`}
                      value={drafts[bucket] ?? ''}
                      onChange={(e) => setDrafts({ ...drafts, [bucket]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(bucket) } }}
                      placeholder="Add one"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => add(bucket)}
                      disabled={busy || !(drafts[bucket] ?? '').trim()}
                      id={`swot-add-${bucket}`}
                      aria-label={`Add to ${SWOT_LABELS[bucket]}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      <p className="text-muted-foreground text-xs">
        Four lists, not a diagram. There is no drawing canvas here on purpose - this stays
        something you can read in twenty seconds.
      </p>
    </div>
  )
}
