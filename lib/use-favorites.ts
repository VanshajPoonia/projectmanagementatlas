'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  boardFavoriteTargets,
  isFavorite,
  resolveFavorites,
  setFavorite,
  sortFavorites,
  type FavoriteEntityType,
  type FavoriteRow,
  type ResolvedFavorite,
} from '@/lib/favorites'

interface UseFavoritesOptions {
  /**
   * Where a starred board links to. Differs by surface — the admin shell routes board
   * links through /admin/board/:id, the user shell through /dashboard/board/:id — so the
   * host supplies it rather than this hook guessing from the URL.
   */
  boardHref: (boardId: string) => string
}

/**
 * The viewer's own starred list, resolved to things they can actually open.
 *
 * RLS scopes every read and write on user_favorites to `user_id = auth.uid()`, so this never
 * filters by user client-side — the trap CLAUDE.md records from the marketing-checks bug,
 * where a client `.eq('user_id', …)` threw away rows the policy had already cleared. The
 * insert still writes `user_id` explicitly because the column has no default; the policy's
 * WITH CHECK is what makes writing someone else's id impossible, not the client.
 *
 * The second query is what makes this safe to drop into any shell host. Favourites store a
 * bare uuid with no foreign key, so the hook asks boards for those ids and lets boards' own
 * RLS (061/070) answer — a starred board that was deleted, archived, or turned private
 * behind the viewer's back simply doesn't come back and is dropped. Resolving here rather
 * than in each host also means /my-work and a board page get the sidebar block without
 * having to fetch a board list they otherwise have no use for.
 */
export function useFavorites(userId: string, { boardHref }: UseFavoritesOptions) {
  const [favorites, setFavorites] = useState<FavoriteRow[]>([])
  const [targets, setTargets] = useState<ReadonlyMap<string, { id: string; label: string; href: string }>>(
    new Map(),
  )
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data } = await supabase
      .from('user_favorites')
      .select('id, entity_type, entity_id, position, created_at')

    const rows = sortFavorites((data ?? []) as FavoriteRow[])
    setFavorites(rows)

    const boardIds = rows.filter((f) => f.entity_type === 'board').map((f) => f.entity_id)
    if (boardIds.length === 0) {
      setTargets(new Map())
      return
    }

    // Archived boards are excluded here for the same reason the boards list excludes them:
    // a favourite is a shortcut to somewhere you work, and an archived board is not that.
    const { data: boards } = await supabase
      .from('boards')
      .select('id, title')
      .in('id', boardIds)
      .is('archived_at', null)

    setTargets(boardFavoriteTargets(boards ?? [], boardHref))
  }, [boardHref])

  useEffect(() => {
    let active = true
    load().finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [load, userId])

  /**
   * Star or unstar. Optimistic, then reconciled.
   *
   * Every setFavorites here uses the functional form: a user can star three boards faster
   * than three round-trips complete, and snapshot-and-restore would drop whichever landed in
   * between. Same reasoning as team-management.tsx's membership grid.
   *
   * Returns whether the write succeeded so callers can toast a failure.
   */
  const toggle = useCallback(
    async (entityType: FavoriteEntityType, entityId: string, shouldBeFavorite: boolean) => {
      const key = `${entityType}:${entityId}`
      setPending((prev) => new Set(prev).add(key))
      setFavorites((prev) => setFavorite(prev, entityType, entityId, shouldBeFavorite))

      const supabase = createClient()
      const { error } = shouldBeFavorite
        ? await supabase
            .from('user_favorites')
            // onConflict on the (user_id, entity_type, entity_id) unique index makes a
            // double-click idempotent instead of a 23505.
            .upsert(
              { user_id: userId, entity_type: entityType, entity_id: entityId },
              { onConflict: 'user_id,entity_type,entity_id', ignoreDuplicates: true },
            )
        : await supabase
            .from('user_favorites')
            .delete()
            .eq('entity_type', entityType)
            .eq('entity_id', entityId)

      setPending((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })

      if (error) {
        // Put the star back where it was. Inverting the same entry leaves any concurrent
        // edit to a different one intact.
        setFavorites((prev) => setFavorite(prev, entityType, entityId, !shouldBeFavorite))
        return false
      }

      // Reload so the optimistic placeholder id is replaced by the real row and the new
      // board joins (or leaves) the resolved list.
      void load()
      return true
    },
    [userId, load],
  )

  const resolved: ResolvedFavorite[] = useMemo(
    () => resolveFavorites(favorites, targets),
    [favorites, targets],
  )

  const starred = useCallback(
    (entityType: FavoriteEntityType, entityId: string) =>
      isFavorite(favorites, entityType, entityId),
    [favorites],
  )

  const isPending = useCallback(
    (entityType: FavoriteEntityType, entityId: string) => pending.has(`${entityType}:${entityId}`),
    [pending],
  )

  return { favorites, resolved, loading, starred, isPending, toggle, refetch: load }
}
