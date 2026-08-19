'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, MinusCircle, PlusCircle, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorState, LoadingRows, PermissionDenied } from '@/components/shell/states'
import { can } from '@/lib/capabilities'
import {
  AUDIT_CATEGORIES,
  actorLabel,
  categoryPattern,
  formatTime,
  groupByDay,
  toneOf,
  type AuditCategory,
  type AuditEvent,
} from '@/lib/audit-events'

// The reading surface for migration 098's audit trail: who changed access to what, when.
//
// Read-only by construction, and not merely by convention - `authenticated` holds SELECT on
// audit_events and nothing else, and the table has no INSERT/UPDATE/DELETE policy at all, so
// there is no request this component could make that would alter the log. That is what makes
// it worth reading.
//
// Gated on the `audit.view` capability for consistency with every other restricted surface,
// but the capability is not the boundary: the RLS policy is admin-only, so a non-admin who
// reached this component would see an empty list rather than anyone else's history.

const PAGE_SIZE = 50

export default function AccessLog({
  currentUserRole,
  currentUserId,
}: {
  currentUserRole: 'user' | 'admin' | 'super_admin'
  currentUserId: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [category, setCategory] = useState<AuditCategory>('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)

  const decision = can({ userId: currentUserId, platformRole: currentUserRole }, 'audit.view')

  /**
   * ⚠️ The category is pushed into the QUERY, not applied to the page afterwards.
   *
   * This used to fetch the 50 newest events and narrow them in the browser, so an empty
   * screen meant "none in the newest 50" while reading as "none at all" - and "Load older
   * entries" was offered or withheld based on the unfiltered count. That is this repo's
   * own "hidden from you and does not exist arrive looking identical" trap, in the one
   * screen whose entire value is being believable.
   */
  const load = useCallback(
    async (limit: number, forCategory: AuditCategory) => {
      let query = supabase
        .from('audit_events')
        .select('id, occurred_at, actor_id, action, entity_type, entity_id, subject_id, summary, metadata')
        .order('occurred_at', { ascending: false })
        .limit(limit + 1)

      const pattern = categoryPattern(forCategory)
      if (pattern) query = query.like('action', pattern)

      const { data, error: queryError } = await query

      if (queryError) {
        setError(queryError.message)
        return
      }

      const rows = (data ?? []) as AuditEvent[]
      setHasMore(rows.length > limit)
      setEvents(rows.slice(0, limit))
      setError(null)

      // Actor names are resolved on read rather than frozen into the row, because "who did
      // this" should follow a rename. The subject's name is frozen into `summary` instead -
      // that one is part of the historical statement.
      const actorIds = [...new Set(rows.map((row) => row.actor_id).filter(Boolean))] as string[]
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles').select('id, full_name, email').in('id', actorIds)
        const rows = (profiles ?? []) as { id: string; full_name: string | null; email: string | null }[]
        setNames(new Map(rows.map((p) => [p.id, p.full_name || p.email || 'Unknown'])))
      }
    },
    [supabase],
  )

  // Re-queries on every category change, which is the point: the filter is a different
  // question for the database, not a different view of the same answer.
  useEffect(() => {
    if (!decision.allowed) {
      setLoading(false)
      return
    }
    setLoading(true)
    load(PAGE_SIZE, category).finally(() => setLoading(false))
  }, [decision.allowed, load, category])

  const refresh = async () => {
    setRefreshing(true)
    await load(Math.max(PAGE_SIZE, events.length), category)
    setRefreshing(false)
  }

  if (!decision.allowed) return <PermissionDenied />

  // No client-side filtering left to do - the query answered the question. filterByCategory
  // still exists for callers holding a complete set in memory; using it here would be a
  // second, weaker filter on top of the authoritative one.
  const days = groupByDay(events)

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">Access log</h2>
          <p className="text-muted-foreground">
            Every change to who can see and do what. Recorded by the database itself, so nothing that
            edits access can skip it.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={refresh}
          disabled={refreshing || loading}
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the access log">
        {AUDIT_CATEGORIES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setCategory(option.id)}
            aria-pressed={category === option.id}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              category === option.id
                ? 'bg-foreground text-background border-foreground'
                : 'hover:bg-accent',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The shared skeleton rather than a bare spinner: it is shaped like the list it
          becomes, so the page does not jump, it announces itself through aria-live, and its
          pulse is motion-safe. LoadingRows had been written and then used only in tests. */}
      {loading && <LoadingRows rows={5} />}

      {!loading && error && (
        <ErrorState
          description={error}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setLoading(true); load(PAGE_SIZE, category).finally(() => setLoading(false)) }}
            >
              Try again
            </Button>
          }
        />
      )}

      {!loading && !error && days.length === 0 && (
        <EmptyState
          icon={<History />}
          title={category === 'all' ? 'Nothing has changed yet' : 'Nothing in this category yet'}
          description={
            category === 'all'
              ? 'Adding someone to a board, changing a role, or switching a module off will show up here.'
              : 'Try a different filter, or switch back to Everything.'
          }
        />
      )}

      {days.map((day) => (
        <section key={day.date} className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {day.label}
          </h3>
          <ul className="divide-y rounded-lg border">
            {day.events.map((event) => {
              const tone = toneOf(event)
              return (
                <li key={event.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                  {/* Icon carries the meaning, colour only reinforces it - the same rule
                      the shared state primitives follow. */}
                  <span
                    className={cn(
                      'mt-0.5 shrink-0',
                      tone === 'grant' && 'text-emerald-600 dark:text-emerald-500',
                      tone === 'revoke' && 'text-amber-600 dark:text-amber-500',
                      tone === 'change' && 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  >
                    {tone === 'grant' ? (
                      <PlusCircle className="h-4 w-4" />
                    ) : tone === 'revoke' ? (
                      <MinusCircle className="h-4 w-4" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words [overflow-wrap:anywhere]">{event.summary}</span>
                    <span className="text-muted-foreground text-xs">
                      {actorLabel(event, names)} · <time dateTime={event.occurred_at}>{formatTime(event.occurred_at)}</time>
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {!loading && !error && hasMore && (
        <Button variant="outline" className="w-full" onClick={() => load(events.length + PAGE_SIZE, category)}>
          Load older entries
        </Button>
      )}
    </div>
  )
}
