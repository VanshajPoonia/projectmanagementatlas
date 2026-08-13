import { describe, expect, it } from 'vitest'
import {
  boardFavoriteTargets,
  favoriteKey,
  isFavorite,
  resolveFavorites,
  setFavorite,
  sortFavorites,
  withFavoritesFirst,
  type FavoriteRow,
} from './favorites'

function row(entity_id: string, over: Partial<FavoriteRow> = {}): FavoriteRow {
  return {
    id: `fav-${entity_id}`,
    entity_type: 'board',
    entity_id,
    position: 0,
    created_at: '2026-08-13T10:00:00.000Z',
    ...over,
  }
}

describe('favoriteKey', () => {
  it('namespaces by entity type so a board and a view can share an id', () => {
    expect(favoriteKey('board', 'abc')).toBe('board:abc')
    expect(favoriteKey('view', 'abc')).toBe('view:abc')
    expect(favoriteKey('board', 'abc')).not.toBe(favoriteKey('view', 'abc'))
  })
})

describe('isFavorite', () => {
  it('finds a starred board', () => {
    expect(isFavorite([row('a')], 'board', 'a')).toBe(true)
  })

  it('is false for an unstarred board', () => {
    expect(isFavorite([row('a')], 'board', 'b')).toBe(false)
  })

  it('does not match across entity types', () => {
    expect(isFavorite([row('a')], 'view', 'a')).toBe(false)
  })

  it('is false on an empty list', () => {
    expect(isFavorite([], 'board', 'a')).toBe(false)
  })
})

describe('setFavorite', () => {
  const now = () => '2026-08-13T12:00:00.000Z'

  it('adds a star that was not there', () => {
    const next = setFavorite([], 'board', 'a', true, now)
    expect(next).toHaveLength(1)
    expect(next[0].entity_id).toBe('a')
    expect(next[0].created_at).toBe('2026-08-13T12:00:00.000Z')
  })

  it('removes a star that was there', () => {
    expect(setFavorite([row('a')], 'board', 'a', false, now)).toEqual([])
  })

  // The reason this takes a desired state rather than flipping: a double-click plus a slow
  // round-trip must not land on the opposite of what was asked for.
  it('starring an already-starred board is a no-op, not a duplicate', () => {
    const next = setFavorite([row('a')], 'board', 'a', true, now)
    expect(next).toHaveLength(1)
  })

  it('unstarring an unstarred board is a no-op', () => {
    expect(setFavorite([row('a')], 'board', 'b', false, now)).toHaveLength(1)
  })

  it('leaves other favourites untouched', () => {
    const next = setFavorite([row('a'), row('b')], 'board', 'c', true, now)
    expect(next.map((f) => f.entity_id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input list', () => {
    const input = [row('a')]
    setFavorite(input, 'board', 'b', true, now)
    expect(input).toHaveLength(1)
  })

  it('inverting a toggle restores the original set', () => {
    const start = [row('a')]
    const added = setFavorite(start, 'board', 'b', true, now)
    const reverted = setFavorite(added, 'board', 'b', false, now)
    expect(reverted.map((f) => f.entity_id)).toEqual(['a'])
  })
})

describe('sortFavorites', () => {
  it('orders by position first', () => {
    const out = sortFavorites([row('a', { position: 2 }), row('b', { position: 1 })])
    expect(out.map((f) => f.entity_id)).toEqual(['b', 'a'])
  })

  it('falls back to created_at within the same position', () => {
    const out = sortFavorites([
      row('a', { created_at: '2026-08-13T11:00:00.000Z' }),
      row('b', { created_at: '2026-08-13T09:00:00.000Z' }),
    ])
    expect(out.map((f) => f.entity_id)).toEqual(['b', 'a'])
  })

  it('does not mutate the input', () => {
    const input = [row('a', { position: 2 }), row('b', { position: 1 })]
    sortFavorites(input)
    expect(input[0].entity_id).toBe('a')
  })
})

describe('resolveFavorites', () => {
  const targets = boardFavoriteTargets(
    [
      { id: 'a', title: 'Atlas Rebuild' },
      { id: 'b', title: 'SRG Listings' },
    ],
    (id) => `/dashboard/board/${id}`,
  )

  it('resolves a favourite to its board', () => {
    const out = resolveFavorites([row('a')], targets)
    expect(out).toEqual([
      {
        key: 'board:a',
        entityType: 'board',
        entityId: 'a',
        label: 'Atlas Rebuild',
        href: '/dashboard/board/a',
      },
    ])
  })

  // The load-bearing case: deleted board, archived board, and revoked access all arrive here
  // as "not in the map", and all three must vanish rather than render a broken link.
  it('drops a favourite whose target is not visible to this viewer', () => {
    const out = resolveFavorites([row('a'), row('gone')], targets)
    expect(out.map((f) => f.entityId)).toEqual(['a'])
  })

  it('drops everything when the viewer can see nothing', () => {
    expect(resolveFavorites([row('a'), row('b')], new Map())).toEqual([])
  })

  it('returns resolved favourites in sorted order', () => {
    const out = resolveFavorites(
      [row('a', { position: 5 }), row('b', { position: 1 })],
      targets,
    )
    expect(out.map((f) => f.entityId)).toEqual(['b', 'a'])
  })

  it('ignores a view favourite while only board targets exist', () => {
    const out = resolveFavorites([row('a', { entity_type: 'view' })], targets)
    expect(out).toEqual([])
  })
})

describe('boardFavoriteTargets', () => {
  it('labels an untitled board rather than rendering an empty link', () => {
    const map = boardFavoriteTargets([{ id: 'a', title: '   ' }], (id) => `/b/${id}`)
    expect(map.get('board:a')?.label).toBe('Untitled board')
  })

  it('handles a null title', () => {
    const map = boardFavoriteTargets([{ id: 'a', title: null }], (id) => `/b/${id}`)
    expect(map.get('board:a')?.label).toBe('Untitled board')
  })

  it('skips entries with no id instead of creating an undefined key', () => {
    const map = boardFavoriteTargets(
      [{ id: '', title: 'Nameless' }, { id: 'a', title: 'Real' }],
      (id) => `/b/${id}`,
    )
    expect([...map.keys()]).toEqual(['board:a'])
  })
})

describe('withFavoritesFirst', () => {
  const boards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('moves starred boards to the front', () => {
    expect(withFavoritesFirst(boards, [row('c')]).map((b) => b.id)).toEqual(['c', 'a', 'b'])
  })

  it('preserves the original order within each group', () => {
    expect(withFavoritesFirst(boards, [row('c'), row('b')]).map((b) => b.id)).toEqual([
      'b',
      'c',
      'a',
    ])
  })

  it('is a no-op when nothing is starred', () => {
    expect(withFavoritesFirst(boards, []).map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores view favourites when ordering boards', () => {
    const out = withFavoritesFirst(boards, [row('c', { entity_type: 'view' })])
    expect(out.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not drop a board that is starred but missing from the list', () => {
    expect(withFavoritesFirst(boards, [row('zzz')])).toHaveLength(3)
  })
})
