'use client'

// Retrospectives: a short look back, with voting, grouping and actions that become real work.
//
// ⚠️ ANONYMITY IS NOT A DISPLAY RULE HERE. On an anonymous review `retro_notes.author_id` is
// NULL in the database and the real author lives in a table `authenticated` holds no privilege
// on (migration 132). So this component has nothing to hide - it could not show an author if it
// tried. "Which of these are mine" comes from public.my_retro_note_ids(), a definer function
// returning only the caller's own ids.
//
// ⚠️ Which is also why `canEditNote` reads that id set rather than author_id. Deriving "mine"
// from author_id would make every anonymous note uneditable by its own author: a UI stricter
// than its policy, taking an ability away from exactly the people the design serves.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, MessageSquareQuote, Plus, ThumbsUp, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { CategorizedStatus } from '@/lib/task-status'
import { findColumnForStatus } from '@/lib/task-status'
import {
  ANONYMITY_PROMISE, ANONYMITY_RESIDUAL, RETRO_TEMPLATES, RETRO_TEMPLATE_HELP,
  RETRO_TEMPLATE_LABELS, canDeleteNote, canEditNote, groupNotes, notesForColumn,
  retroBlockedReason, retroColumnLabel, retroColumns, summarizeRetro,
  type RetroActionRow, type RetroGroupRow, type RetroNoteRow, type RetroTemplate,
  type RetrospectiveRow,
} from '@/lib/retrospectives'
import {
  addRetroAction, addRetroNote, createRetro, createRetroGroup, createWorkItem, deleteRetro,
  deleteRetroAction, deleteRetroGroup, deleteRetroNote, didWrite, loadMyNoteIds, loadMyVotes,
  loadRetrospectives, setVote, updateRetro, updateRetroAction, updateRetroNote,
  writeFailureMessage, type RetroDraft, type StrategyWrite,
} from '@/lib/strategy-data'
import type { BoardOption, ColumnRow, PersonRow } from './strategy-workspace'

function report(outcome: StrategyWrite['outcome'], subject: string): boolean {
  const failure = writeFailureMessage(outcome, subject)
  if (failure) toast.error(failure.title, { description: failure.description })
  return didWrite(outcome)
}

const NONE = '__none__'

export function RetroPanel({
  userId, isAdmin, boards, users, columns, statuses, today,
}: {
  userId: string | null
  isAdmin: boolean
  boards: BoardOption[]
  users: PersonRow[]
  columns: ColumnRow[]
  statuses: CategorizedStatus[]
  today: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [boardId, setBoardId] = useState<string>(boards[0]?.id ?? '')
  const [retros, setRetros] = useState<RetrospectiveRow[]>([])
  const [notes, setNotes] = useState<RetroNoteRow[]>([])
  const [groups, setGroups] = useState<RetroGroupRow[]>([])
  const [actions, setActions] = useState<RetroActionRow[]>([])
  const [retroId, setRetroId] = useState<string | null>(null)
  const [myNoteIds, setMyNoteIds] = useState<Set<string>>(new Set())
  const [myVotes, setMyVotes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<RetroDraft>({ title: '', template: 'what_went_well', is_anonymous: false, held_on: today, sprint_id: null })
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [groupDraft, setGroupDraft] = useState('')
  const [actionDraft, setActionDraft] = useState({ body: '', owner_id: NONE, due_date: '' })
  const [converting, setConverting] = useState<RetroActionRow | null>(null)

  const peopleById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name || u.email || 'Someone'])), [users])
  const retro = useMemo(() => retros.find((r) => r.id === retroId) ?? null, [retros, retroId])
  const retroNotes = useMemo(() => notes.filter((n) => n.retro_id === retroId), [notes, retroId])
  const retroGroups = useMemo(() => groups.filter((g) => g.retro_id === retroId), [groups, retroId])
  const retroActions = useMemo(() => actions.filter((a) => a.retro_id === retroId), [actions, retroId])
  const blocked = retroBlockedReason(retro)

  // ⚠️ A generation ref, because a slow read must not overwrite a fast click. The inbox shipped
  // exactly this bug: pressing Follow before the initial read returned put the button back.
  const generation = useRef(0)

  const load = useCallback(async (board: string) => {
    if (!board) return
    const mine = ++generation.current
    setLoading(true)
    try {
      const data = await loadRetrospectives(supabase, board)
      if (generation.current !== mine) return
      setRetros(data.retros)
      setNotes(data.notes)
      setGroups(data.groups)
      setActions(data.actions)
      setLoadFailed(data.loadFailed)
      setRetroId((prev) => (prev && data.retros.some((r) => r.id === prev) ? prev : data.retros[0]?.id ?? null))
    } finally {
      if (generation.current === mine) setLoading(false)
    }
  }, [supabase])

  useEffect(() => { void load(boardId) }, [boardId, load])

  useEffect(() => {
    if (!retroId) { setMyNoteIds(new Set()); setMyVotes(new Set()); return }
    let live = true
    void (async () => {
      const [ids, votes] = await Promise.all([
        loadMyNoteIds(supabase, retroId),
        loadMyVotes(supabase, notes.filter((n) => n.retro_id === retroId).map((n) => n.id)),
      ])
      if (!live) return
      setMyNoteIds(ids)
      setMyVotes(votes)
    })()
    return () => { live = false }
  }, [retroId, notes, supabase])

  const create = async () => {
    if (!draft.title.trim() || !boardId) return
    setBusy(true)
    try {
      const res = await createRetro(supabase, boardId, draft, userId)
      if (!report(res.outcome, 'review')) return
      if (res.retro) { setRetros((prev) => [res.retro!, ...prev]); setRetroId(res.retro.id) }
      setCreating(false)
      setDraft({ title: '', template: 'what_went_well', is_anonymous: false, held_on: today, sprint_id: null })
    } finally {
      setBusy(false)
    }
  }

  const addNote = async (columnKey: string) => {
    const body = (noteDrafts[columnKey] ?? '').trim()
    if (!body || !retroId) return
    setBusy(true)
    try {
      const res = await addRetroNote(supabase, retroId, columnKey, body)
      if (!report(res.outcome, 'note')) return
      if (res.note) {
        setNotes((prev) => [...prev, res.note!])
        setMyNoteIds((prev) => new Set([...prev, res.note!.id]))
      }
      setNoteDrafts({ ...noteDrafts, [columnKey]: '' })
    } finally {
      setBusy(false)
    }
  }

  const removeNote = async (noteId: string) => {
    setBusy(true)
    try {
      const res = await deleteRetroNote(supabase, noteId)
      if (!report(res.outcome, 'note')) return
      setNotes((prev) => prev.filter((n) => n.id !== noteId))
    } finally {
      setBusy(false)
    }
  }

  const toggleVote = async (note: RetroNoteRow) => {
    if (!userId) return
    const voted = myVotes.has(note.id)
    setBusy(true)
    try {
      const res = await setVote(supabase, note.id, userId, !voted)
      if (!report(res.outcome, 'vote')) return
      setMyVotes((prev) => {
        const next = new Set(prev)
        if (voted) next.delete(note.id); else next.add(note.id)
        return next
      })
      // The count is maintained by a trigger, so it has to be read back rather than guessed.
      const { data } = await supabase.from('retro_notes').select('id, vote_count').eq('id', note.id).maybeSingle()
      if (data) setNotes((prev) => prev.map((n) => (n.id === data.id ? { ...n, vote_count: data.vote_count } : n)))
    } finally {
      setBusy(false)
    }
  }

  const addGroup = async () => {
    if (!groupDraft.trim() || !retroId) return
    setBusy(true)
    try {
      const res = await createRetroGroup(supabase, retroId, groupDraft.trim(), userId)
      if (!report(res.outcome, 'theme')) return
      if (res.group) setGroups((prev) => [...prev, res.group!])
      setGroupDraft('')
    } finally {
      setBusy(false)
    }
  }

  const assignGroup = async (note: RetroNoteRow, groupId: string | null) => {
    setBusy(true)
    try {
      const res = await updateRetroNote(supabase, note.id, { group_id: groupId })
      if (!report(res.outcome, 'note')) return
      if (res.note) setNotes((prev) => prev.map((n) => (n.id === res.note!.id ? res.note! : n)))
    } finally {
      setBusy(false)
    }
  }

  const removeGroup = async (groupId: string) => {
    setBusy(true)
    try {
      const res = await deleteRetroGroup(supabase, groupId)
      if (!report(res.outcome, 'theme')) return
      setGroups((prev) => prev.filter((g) => g.id !== groupId))
      // group_id is ON DELETE SET NULL, so the notes survive and simply become ungrouped.
      setNotes((prev) => prev.map((n) => (n.group_id === groupId ? { ...n, group_id: null } : n)))
    } finally {
      setBusy(false)
    }
  }

  const addAction = async () => {
    if (!actionDraft.body.trim() || !retroId) return
    setBusy(true)
    try {
      const res = await addRetroAction(supabase, retroId, actionDraft.body.trim(), {
        owner_id: actionDraft.owner_id === NONE ? null : actionDraft.owner_id,
        due_date: actionDraft.due_date || null,
      }, userId)
      if (!report(res.outcome, 'action')) return
      if (res.action) setActions((prev) => [...prev, res.action!])
      setActionDraft({ body: '', owner_id: NONE, due_date: '' })
    } finally {
      setBusy(false)
    }
  }

  const removeAction = async (actionId: string) => {
    setBusy(true)
    try {
      const res = await deleteRetroAction(supabase, actionId)
      if (!report(res.outcome, 'action')) return
      setActions((prev) => prev.filter((a) => a.id !== actionId))
    } finally {
      setBusy(false)
    }
  }

  const convertAction = async () => {
    if (!converting || !boardId) return
    setBusy(true)
    try {
      const boardColumns = columns.filter((c) => c.board_id === boardId)
      const target = statuses.find((s) => s.category === 'planned' && !(s as any).is_archived)
        ?? statuses.find((s) => !(s as any).is_archived)
      const column = (target
        ? findColumnForStatus(target.key, (target as any).label, boardColumns as any)
        : undefined) ?? boardColumns[0]
      if (!column) {
        toast.error('This project has no columns', { description: 'Add a column to it first, then convert.' })
        return
      }
      const created = await createWorkItem(supabase, {
        column_id: (column as any).id,
        title: converting.body,
        assigned_to: converting.owner_id ?? null,
        due_date: converting.due_date ?? null,
        status: (column as any).status_key ?? 'to_do',
      }, userId)
      if (!report(created.outcome, 'work item')) return
      if (!created.task) return
      const linked = await updateRetroAction(supabase, converting.id, { task_id: created.task.id })
      if (!report(linked.outcome, 'action')) return
      if (linked.action) setActions((prev) => prev.map((a) => (a.id === linked.action!.id ? linked.action! : a)))
      setConverting(null)
      toast.success('Work item created', { description: 'It is an ordinary task on this board, so it shows up in My Work like anything else.' })
    } finally {
      setBusy(false)
    }
  }

  const closeRetro = async () => {
    if (!retro) return
    setBusy(true)
    try {
      const res = await updateRetro(supabase, retro.id, { state: retro.state === 'open' ? 'closed' : 'open' })
      if (!report(res.outcome, 'review')) return
      if (res.retro) setRetros((prev) => prev.map((r) => (r.id === res.retro!.id ? res.retro! : r)))
    } finally {
      setBusy(false)
    }
  }

  const removeRetro = async () => {
    if (!retro) return
    setBusy(true)
    try {
      const res = await deleteRetro(supabase, retro.id)
      if (!report(res.outcome, 'review')) return
      setRetros((prev) => prev.filter((r) => r.id !== retro.id))
      setRetroId(null)
    } finally {
      setBusy(false)
    }
  }

  if (boards.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquareQuote />}
        title="No projects you can see"
        description="A review looks back at a project's work, so this needs at least one board you have access to."
      />
    )
  }

  const summary = retro ? summarizeRetro(retroNotes, retroGroups, retroActions) : null
  const themed = groupNotes(retroNotes, retroGroups)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={boardId} onValueChange={setBoardId}>
          <SelectTrigger id="retro-board" className="w-[16rem]"><SelectValue placeholder="Pick a project" /></SelectTrigger>
          <SelectContent>
            {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
          </SelectContent>
        </Select>

        {retros.length > 0 && (
          <Select value={retroId ?? ''} onValueChange={setRetroId}>
            <SelectTrigger id="retro-picker" className="w-[16rem]"><SelectValue placeholder="Pick a review" /></SelectTrigger>
            <SelectContent>
              {retros.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.title}{r.state === 'closed' ? ' - closed' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)} disabled={busy || !boardId} id="retro-new">
          <Plus className="mr-1 h-4 w-4" /> New review
        </Button>
      </div>

      {loadFailed && (
        <p className="text-muted-foreground text-sm">
          Some of this review could not be loaded, so what is on screen may be incomplete.
        </p>
      )}

      {!loading && retros.length === 0 ? (
        <EmptyState
          icon={<MessageSquareQuote />}
          title="No reviews on this project yet"
          description="A review is a short look back: everyone adds notes about how something went, votes on what matters, and the agreed actions become real work items."
          action={<Button size="sm" onClick={() => setCreating(true)} id="retro-new-empty">Start the first one</Button>}
        />
      ) : retro ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium">{retro.title}</h2>
            <Badge variant="outline">{RETRO_TEMPLATE_LABELS[retro.template]}</Badge>
            {retro.is_anonymous && <Badge variant="secondary" id="retro-anon-badge">Anonymous</Badge>}
            {retro.state === 'closed' && <Badge variant="outline">Closed</Badge>}
            {summary && (
              <span className="text-muted-foreground text-sm">
                {summary.notes} note{summary.notes === 1 ? '' : 's'}, {summary.votes} vote{summary.votes === 1 ? '' : 's'}, {summary.actions} action{summary.actions === 1 ? '' : 's'}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" onClick={closeRetro} disabled={busy} id="retro-toggle-state">
                {retro.state === 'open' ? 'Close review' : 'Reopen'}
              </Button>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="text-destructive" onClick={removeRetro} disabled={busy} aria-label="Delete review">
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {retro.is_anonymous && (
            <div className="space-y-1 rounded-md border-l-2 px-3 py-2 text-sm" id="retro-anon-note">
              <p>{ANONYMITY_PROMISE}</p>
              <p className="text-muted-foreground text-xs leading-relaxed">{ANONYMITY_RESIDUAL}</p>
            </div>
          )}

          {blocked && <p className="text-muted-foreground text-sm" id="retro-blocked">{blocked}</p>}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" id="retro-columns">
            {retroColumns(retro.template).map((columnKey) => (
              <Card key={columnKey} data-column={columnKey}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{retroColumnLabel(columnKey)}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {notesForColumn(retroNotes, columnKey).map((note) => (
                    <div key={note.id} className="space-y-1.5 rounded-md border px-3 py-2 text-sm" data-note-id={note.id}>
                      <p className="whitespace-pre-wrap">{note.body}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant={myVotes.has(note.id) ? 'secondary' : 'ghost'}
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => toggleVote(note)}
                          disabled={busy || retro.state !== 'open'}
                          aria-pressed={myVotes.has(note.id)}
                          aria-label={`${myVotes.has(note.id) ? 'Remove your vote from' : 'Vote for'} "${note.body}"`}
                        >
                          <ThumbsUp className="h-3 w-3" />
                          <span className="tabular-nums">{note.vote_count}</span>
                        </Button>
                        {/* ⚠️ Only ever the PUBLIC author, which is NULL on an anonymous review
                            because the database made it so, not because this hides it. */}
                        {!retro.is_anonymous && note.author_id && (
                          <span className="text-muted-foreground text-xs">
                            {peopleById.get(note.author_id) ?? 'Someone'}
                          </span>
                        )}
                        {retroGroups.length > 0 && retro.state === 'open' && (
                          <Select
                            value={note.group_id ?? NONE}
                            onValueChange={(v) => assignGroup(note, v === NONE ? null : v)}
                          >
                            <SelectTrigger className="h-7 w-[9rem] text-xs" aria-label="Theme"><SelectValue placeholder="No theme" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No theme</SelectItem>
                              {retroGroups.map((g) => <SelectItem key={g.id} value={g.id}>{g.title}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {canDeleteNote(note, myNoteIds, isAdmin) && (
                          <button
                            type="button"
                            onClick={() => removeNote(note.id)}
                            disabled={busy}
                            className="text-muted-foreground hover:text-destructive ml-auto"
                            aria-label="Delete note"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {canEditNote(note, myNoteIds, retro) && (
                        <p className="text-muted-foreground text-xs">Yours</p>
                      )}
                    </div>
                  ))}

                  {retro.state === 'open' && (
                    <div className="flex gap-2">
                      <Textarea
                        id={`retro-note-${columnKey}`}
                        rows={2}
                        value={noteDrafts[columnKey] ?? ''}
                        onChange={(e) => setNoteDrafts({ ...noteDrafts, [columnKey]: e.target.value })}
                        placeholder="Add a note"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addNote(columnKey)}
                        disabled={busy || !(noteDrafts[columnKey] ?? '').trim()}
                        id={`retro-add-${columnKey}`}
                        aria-label={`Add a note to ${retroColumnLabel(columnKey)}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Themes */}
          <Card id="retro-themes">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Themes</CardTitle>
              <p className="text-muted-foreground text-xs">
                Five people writing slightly different sentences about the same problem reads as
                five weak signals until you gather them. A theme is weighed by the votes of
                everything in it.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {themed.filter((t) => t.group).length === 0 && (
                <p className="text-muted-foreground text-xs">No themes yet.</p>
              )}
              <ul className="space-y-2">
                {themed.filter((t) => t.group).map((theme) => (
                  <li key={theme.group!.id} className="rounded-md border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{theme.group!.title}</span>
                      <Badge variant="outline" className="tabular-nums">{theme.votes} vote{theme.votes === 1 ? '' : 's'}</Badge>
                      <span className="text-muted-foreground text-xs">{theme.notes.length} note{theme.notes.length === 1 ? '' : 's'}</span>
                      <button
                        type="button"
                        onClick={() => removeGroup(theme.group!.id)}
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive ml-auto"
                        aria-label={`Remove the theme ${theme.group!.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {retro.state === 'open' && (
                <div className="flex gap-2">
                  <Input
                    id="retro-theme-input"
                    value={groupDraft}
                    onChange={(e) => setGroupDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGroup() } }}
                    placeholder="Name a theme, then file notes under it"
                  />
                  <Button size="sm" variant="outline" onClick={addGroup} disabled={busy || !groupDraft.trim()} id="retro-theme-add">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                Removing a theme keeps its notes - they simply become ungrouped.
              </p>
            </CardContent>
          </Card>

          {/* Actions */}
          <Card id="retro-actions">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Actions</CardTitle>
              <p className="text-muted-foreground text-xs">
                Turning one into a work item creates an ordinary task on this board, so it
                appears in My Work like anything else instead of being forgotten in a document.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {retroActions.length === 0 && <p className="text-muted-foreground text-xs">Nothing agreed yet.</p>}
              <ul className="space-y-2">
                {retroActions.map((action) => (
                  <li key={action.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm" data-action-id={action.id}>
                    <span className="min-w-0 flex-1 break-words">{action.body}</span>
                    {action.owner_id && (
                      <span className="text-muted-foreground text-xs">{peopleById.get(action.owner_id) ?? 'Someone'}</span>
                    )}
                    {action.due_date && <span className="text-muted-foreground text-xs tabular-nums">{action.due_date}</span>}
                    {action.converted_at ? (
                      <Badge variant="secondary" className="gap-1">
                        <Check className="h-3 w-3" /> Became work
                      </Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setConverting(action)} disabled={busy} id={`retro-convert-${action.id}`}>
                        <ArrowRight className="h-3 w-3" /> Make it work
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAction(action.id)}
                      disabled={busy}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete action"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_10rem_auto]">
                <Input
                  id="retro-action-input"
                  value={actionDraft.body}
                  onChange={(e) => setActionDraft({ ...actionDraft, body: e.target.value })}
                  placeholder="What are we going to do about it?"
                />
                <Select value={actionDraft.owner_id} onValueChange={(v) => setActionDraft({ ...actionDraft, owner_id: v })}>
                  <SelectTrigger id="retro-action-owner" aria-label="Action owner"><SelectValue placeholder="Owner" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No owner</SelectItem>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  id="retro-action-due"
                  type="date"
                  value={actionDraft.due_date}
                  onChange={(e) => setActionDraft({ ...actionDraft, due_date: e.target.value })}
                  aria-label="Action due date"
                />
                <Button size="sm" onClick={addAction} disabled={busy || !actionDraft.body.trim()} id="retro-action-add">Add</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* New review */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New review</DialogTitle>
            <DialogDescription>
              A short look back at how something went. Pick whichever template suits the
              conversation - they only change the column headings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="retro-title">What are we looking back at?</Label>
              <Input id="retro-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="The Riverside handover" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="retro-template">Template</Label>
              <Select value={draft.template} onValueChange={(v) => setDraft({ ...draft, template: v as RetroTemplate })}>
                <SelectTrigger id="retro-template"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RETRO_TEMPLATES.map((t) => <SelectItem key={t} value={t}>{RETRO_TEMPLATE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{RETRO_TEMPLATE_HELP[draft.template]}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="retro-held">Date</Label>
              <Input id="retro-held" type="date" value={draft.held_on ?? ''} onChange={(e) => setDraft({ ...draft, held_on: e.target.value || null })} />
            </div>

            <div className="space-y-1.5 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  id="retro-anonymous"
                  checked={draft.is_anonymous}
                  onChange={(e) => setDraft({ ...draft, is_anonymous: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Anonymous</span>
                  <span className="text-muted-foreground block text-xs leading-relaxed">
                    {ANONYMITY_PROMISE} This cannot be changed once the review exists, in either
                    direction, because people write under the rule that is in force at the time.
                  </span>
                </span>
              </label>
              {draft.is_anonymous && (
                <p className="text-muted-foreground border-l-2 pl-3 text-xs leading-relaxed">{ANONYMITY_RESIDUAL}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy || !draft.title.trim()} id="retro-create">Start it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert an action */}
      <Dialog open={Boolean(converting)} onOpenChange={(open) => !open && setConverting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Turn this into a work item</DialogTitle>
            <DialogDescription>
              A normal task is created on this board, carrying the owner and date you set here.
              The action stays in the review with a link to it.
            </DialogDescription>
          </DialogHeader>
          <p className={cn('rounded-md border px-3 py-2 text-sm')}>{converting?.body}</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConverting(null)}>Cancel</Button>
            <Button onClick={convertAction} disabled={busy} id="retro-convert-save">Create the work item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
