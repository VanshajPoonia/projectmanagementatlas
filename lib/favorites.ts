// Favourites - the per-user starred list behind the sidebar's Favourites block, the star on
// each board card, and the palette's Favourites group.
//
// Pure logic only (the React hook lives in use-favorites.ts) so ordering, de-duplication and
// the resolve-against-what-you-can-actually-see rule are unit-testable without a DOM. Same
// split as recent-records.ts / use-recent-records.ts.
//
// Storage is `public.user_favorites` (migration 097), not localStorage. Recents and density
// are per browser on purpose - they are cheap to lose. A curated star list is not.

export type FavoriteEntityType = 'board' | 'view'

/** A row of public.user_favorites, as the client reads it. */
export interface FavoriteRow {
  id: string
  entity_type: FavoriteEntityType
  entity_id: string
  position: number
  created_at: string
}

/** A favourite that has been matched back to something the viewer can actually see. */
export interface ResolvedFavorite {
  key: string
  entityType: FavoriteEntityType
  entityId: string
  label: string
  href: string
}

/** Anything a favourite can point at, as far as this module is concerned. */
export interface FavoriteTarget {
  id: string
  label: string
  href: string
}

/**
 * How many favourites the sidebar shows before it stops. Favourites are meant to be the
 * short list you curated; past this many it is just a second copy of the boards list, and
 * the sidebar has finite height.
 */
export const FAVORITES_VISIBLE_LIMIT = 6

/** Stable identity for a favourite, matching the table's (entity_type, entity_id) unique key. */
export function favoriteKey(entityType: FavoriteEntityType, entityId: string): string {
  return `${entityType}:${entityId}`
}

/** Is this thing starred? */
export function isFavorite(
  favorites: readonly FavoriteRow[],
  entityType: FavoriteEntityType,
  entityId: string,
): boolean {
  return favorites.some((f) => f.entity_type === entityType && f.entity_id === entityId)
}

/**
 * Star or unstar locally, for optimistic UI.
 *
 * Takes the desired end state rather than flipping whatever is there, so a double-click and
 * a slow round-trip cannot land on the opposite of what the user asked for. Mirrors
 * lib/teams.ts::toggleMembership, and for the same reason.
 */
export function setFavorite(
  favorites: readonly FavoriteRow[],
  entityType: FavoriteEntityType,
  entityId: string,
  shouldBeFavorite: boolean,
  now: () => string = () => new Date().toISOString(),
): FavoriteRow[] {
  const without = favorites.filter(
    (f) => !(f.entity_type === entityType && f.entity_id === entityId),
  )
  if (!shouldBeFavorite) return without
  if (without.length === favorites.length) {
    // Not present - add it. The id is a placeholder until the insert returns; nothing keys
    // off it, and the next refetch replaces the row wholesale.
    return [
      ...without,
      {
        id: `pending:${favoriteKey(entityType, entityId)}`,
        entity_type: entityType,
        entity_id: entityId,
        position: 0,
        created_at: now(),
      },
    ]
  }
  // Already present and asked to stay - return the original list untouched so React can skip
  // the re-render.
  return [...favorites]
}

/** Oldest star first, honouring `position` when it is ever used for manual ordering. */
export function sortFavorites(favorites: readonly FavoriteRow[]): FavoriteRow[] {
  return [...favorites].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  )
}

/**
 * Match favourites back to real, visible things.
 *
 * This is the load-bearing function. `user_favorites` rows carry a bare uuid with no foreign
 * key (entity_id is polymorphic) and no visibility check in their RLS policy - deliberately,
 * see 097's header. So a favourite can outlive its target three ways: the board was deleted,
 * the board was archived out of the caller's query, or the board went private and the caller
 * is no longer a member. All three arrive here identically, as "the id isn't in the targets
 * map", and all three are handled by dropping it.
 *
 * That means a stale star renders as nothing rather than as a broken link, and a user whose
 * access was revoked stops seeing the name of the board they lost - the favourite row still
 * exists in their list, but it is inert. Silence is the correct failure here, so this
 * deliberately does not surface an "unavailable" placeholder.
 */
export function resolveFavorites(
  favorites: readonly FavoriteRow[],
  targets: ReadonlyMap<string, FavoriteTarget>,
): ResolvedFavorite[] {
  return sortFavorites(favorites).flatMap((f) => {
    const target = targets.get(favoriteKey(f.entity_type, f.entity_id))
    if (!target) return []
    return [
      {
        key: favoriteKey(f.entity_type, f.entity_id),
        entityType: f.entity_type,
        entityId: f.entity_id,
        label: target.label,
        href: target.href,
      },
    ]
  })
}

/** Build the lookup `resolveFavorites` wants from a list of boards the viewer can read. */
export function boardFavoriteTargets(
  boards: ReadonlyArray<{ id: string; title?: string | null }>,
  hrefFor: (boardId: string) => string,
): Map<string, FavoriteTarget> {
  const map = new Map<string, FavoriteTarget>()
  for (const board of boards) {
    if (!board?.id) continue
    map.set(favoriteKey('board', board.id), {
      id: board.id,
      label: board.title?.trim() || 'Untitled board',
      href: hrefFor(board.id),
    })
  }
  return map
}

/**
 * Order a board list so starred boards come first, each group keeping its original order.
 *
 * Sorting rather than splitting into two rendered sections is deliberate: a second "Favourites"
 * heading above the boards grid would duplicate the sidebar block that already exists, and the
 * star on each card is what tells you which is which.
 */
export function withFavoritesFirst<T extends { id: string }>(
  boards: readonly T[],
  favorites: readonly FavoriteRow[],
): T[] {
  const starred = new Set(
    favorites.filter((f) => f.entity_type === 'board').map((f) => f.entity_id),
  )
  const first: T[] = []
  const rest: T[] = []
  for (const board of boards) (starred.has(board.id) ? first : rest).push(board)
  return [...first, ...rest]
}
