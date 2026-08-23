'use client'

/**
 * Relations on a work item - the consumer side of migration 115.
 *
 * Reads `task_relations_expanded`, which shows every relation from both ends, so this panel
 * never has to work out which way the stored row happens to point. Writes go to the base
 * table via `toCanonical`, which turns "blocked by" into the same row "blocks" would have
 * produced with the ends swapped - that is what keeps the two from ever disagreeing.
 *
 * ⚠️ Not to be confused with the Links tab, which is `task_links` - external URL bookmarks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Link2, X, Plus, Ban } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage } from '@/lib/rls-write'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { getNormalizedTaskStatus } from '@/lib/task-status'
import {
  groupRelations,
  blockingRelations,
  relationRejectionReason,
  toCanonical,
  SELECTABLE_RELATIONS,
  RELATION_LABELS,
  RELATION_HINTS,
  type DisplayRelation,
  type ExpandedRelation,
} from '@/lib/task-relations'

interface RelatedTask {
  id: string
  title: string
  status?: string | null
  column?: { status_key?: string | null; title?: string } | null
}

interface TaskRelationsPanelProps {
  taskId: string
  canEdit: boolean
  currentUserId: string
}

export default function TaskRelationsPanel({ taskId, canEdit, currentUserId }: TaskRelationsPanelProps) {
  const supabase = createClient()
  const statuses = useTaskStatuses()

  const [relations, setRelations] = useState<ExpandedRelation[]>([])
  const [related, setRelated] = useState<Record<string, RelatedTask>>({})
  const [adding, setAdding] = useState(false)
  const [relation, setRelation] = useState<DisplayRelation>('blocked_by')
  const [search, setSearch] = useState('')
  const [matches, setMatches] = useState<RelatedTask[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('task_relations_expanded')
      .select('id, task_id, related_task_id, relation, is_inverse')
      .eq('task_id', taskId)

    const rows = (data ?? []) as ExpandedRelation[]
    setRelations(rows)

    const ids = rows.map((r) => r.related_task_id)
    if (ids.length === 0) {
      setRelated({})
      return
    }
    // The relation rows are already filtered by RLS to pairs this user can see both ends of,
    // so every id here is readable. Fetching titles separately keeps the view free of a join
    // whose visibility rules would then need reasoning about twice.
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, column:columns(status_key, title)')
      .in('id', ids)
    setRelated(Object.fromEntries(
      ((tasks ?? []) as unknown as RelatedTask[]).map((t) => [t.id, t]),
    ))
  }, [supabase, taskId])

  useEffect(() => { void load() }, [load])

  // Search runs against `tasks`, so RLS decides what is offered - a work item the user cannot
  // see is not in the list, rather than being offered and refused on save.
  useEffect(() => {
    const term = search.trim()
    if (!adding || term.length < 2) {
      setMatches([])
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from('tasks')
        .select('id, title, status, column:columns(status_key, title)')
        .ilike('title', `%${term}%`)
        .is('deleted_at', null)
        .is('archived_at', null)
        .neq('id', taskId)
        .limit(8)
      if (active) setMatches((data ?? []) as unknown as RelatedTask[])
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [search, adding, supabase, taskId])

  const groups = useMemo(() => groupRelations(relations), [relations])

  // Open blockers only. A completed or cancelled blocker is not standing in the way, and
  // openness comes from the status CATEGORY (migration 112), never from the status name.
  const openBlockers = useMemo(
    () => blockingRelations(relations, (id) => {
      const task = related[id]
      if (!task) return false
      return getNormalizedTaskStatus(task, statuses) !== 'done'
    }),
    [relations, related, statuses],
  )

  async function addRelation(otherId: string) {
    const reason = relationRejectionReason(taskId, relation, otherId, relations)
    if (reason) {
      toast.error(reason)
      return
    }

    setBusy(true)
    const outcome = await classifyWrite(
      await supabase.from('task_relations')
        .insert({ ...toCanonical(taskId, relation, otherId), created_by: currentUserId })
        .select('id'),
    )
    setBusy(false)

    if (outcome.kind === 'error') {
      // The cycle guard's message explains itself better than a generic failure would.
      toast.error('Could not add that relation', { description: outcome.message })
      return
    }
    const failure = writeFailureMessage(outcome, 'relation')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }

    setAdding(false)
    setSearch('')
    await load()
  }

  async function removeRelation(row: ExpandedRelation) {
    const outcome = await classifyWrite(
      await supabase.from('task_relations').delete().eq('id', row.id).select('id'),
    )
    const failure = writeFailureMessage(outcome, 'relation')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }
    await load()
  }

  return (
    <div className="border-t pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Relations</h3>
          {relations.length > 0 && (
            <span className="text-xs text-muted-foreground">({relations.length})</span>
          )}
        </div>
        {canEdit && !adding && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Add relation
          </Button>
        )}
      </div>

      {openBlockers.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            Blocked by {openBlockers.length} open work item{openBlockers.length === 1 ? '' : 's'}:{' '}
            {openBlockers.map((b) => related[b.related_task_id]?.title ?? 'an item').join(', ')}.
          </span>
        </div>
      )}

      {adding && (
        <div className="mb-3 space-y-2 rounded-md border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="relation-kind" className="text-xs">This work item</Label>
            <Select value={relation} onValueChange={(v) => setRelation(v as DisplayRelation)}>
              <SelectTrigger id="relation-kind" className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SELECTABLE_RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>{RELATION_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{RELATION_HINTS[relation]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="relation-search" className="text-xs">Which work item?</Label>
            <Input
              id="relation-search"
              className="h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title…"
              autoFocus
            />
          </div>

          {matches.length > 0 && (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {matches.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => addRelation(m.id)}
                    className="w-full rounded p-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    {m.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim().length >= 2 && matches.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nothing matching. Only work items you can already see are listed.
            </p>
          )}

          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setSearch('') }}>
            Cancel
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing related yet. Relations record what blocks this, what it blocks, and what it
          duplicates - separately from subtasks, which are parts of this item rather than
          independent work.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.relation}>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</div>
              <ul className="space-y-1">
                {group.items.map((row) => {
                  const other = related[row.related_task_id]
                  const closed = other
                    ? getNormalizedTaskStatus(other, statuses) === 'done'
                    : false
                  return (
                    <li
                      key={`${row.id}-${row.is_inverse}`}
                      className="flex items-center justify-between gap-2 rounded border px-2.5 py-1.5"
                    >
                      <span className={`min-w-0 truncate text-sm ${closed ? 'text-muted-foreground line-through' : ''}`}>
                        {other?.title ?? 'Untitled work item'}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {closed && (
                          <Badge variant="outline" className="text-[10px] font-normal">Closed</Badge>
                        )}
                        {canEdit && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove relation to ${other?.title ?? 'work item'}`}
                            onClick={() => removeRelation(row)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
