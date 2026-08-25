import { describe, it, expect } from 'vitest'
import {
  descendantBoardIds,
  resolveScopedBoardIds,
  taskInScope,
  ancestorBoardIds,
  buildBoardTree,
  flattenBoardTree,
  invalidParentIds,
  scopeBoardCount,
} from './board-hierarchy'

// A three-generation forest:
//   atlas ── bids ── bids-2026
//         └─ ops
//   srg  (a separate root)
const BOARDS = [
  { id: 'atlas', title: 'Atlas GC', parent_board_id: null },
  { id: 'bids', title: 'Bids', parent_board_id: 'atlas' },
  { id: 'bids-2026', title: 'Bids 2026', parent_board_id: 'bids' },
  { id: 'ops', title: 'Operations', parent_board_id: 'atlas' },
  { id: 'srg', title: 'Shanks Realty', parent_board_id: null },
]

describe('descendant scope', () => {
  it('none returns only the board itself', () => {
    expect(descendantBoardIds(BOARDS, 'atlas', 'none')).toEqual(['atlas'])
  })

  it('direct returns the board and one generation, never two', () => {
    const ids = descendantBoardIds(BOARDS, 'atlas', 'direct')
    expect(ids.sort()).toEqual(['atlas', 'bids', 'ops'])
    expect(ids).not.toContain('bids-2026')
  })

  it('all reaches every generation', () => {
    expect(descendantBoardIds(BOARDS, 'atlas', 'all').sort())
      .toEqual(['atlas', 'bids', 'bids-2026', 'ops'])
  })

  it('a leaf has no descendants but is still in its own scope', () => {
    expect(descendantBoardIds(BOARDS, 'bids-2026', 'all')).toEqual(['bids-2026'])
  })

  it('does not cross into a sibling root', () => {
    expect(descendantBoardIds(BOARDS, 'atlas', 'all')).not.toContain('srg')
  })

  // This is the entire point of the feature - ATLAS_01 4.6.
  it('a board created after the view was saved is in the roll-up with no view edit', () => {
    const before = descendantBoardIds(BOARDS, 'atlas', 'all')
    expect(before).not.toContain('bids-q3')

    const after = descendantBoardIds(
      [...BOARDS, { id: 'bids-q3', title: 'Q3 bids', parent_board_id: 'bids' }],
      'atlas',
      'all',
    )
    expect(after).toContain('bids-q3')
  })

  it('scopes a board the caller cannot see to just that board', () => {
    expect(descendantBoardIds(BOARDS, 'unknown-board', 'all')).toEqual(['unknown-board'])
  })
})

describe('boards the caller cannot see', () => {
  // RLS hands back a partial list. The chain runs THROUGH the hidden board, so the grandchild
  // is out of scope - which is the correct answer, because including it would announce that
  // the hidden board exists.
  const PARTIAL = BOARDS.filter((b) => b.id !== 'bids')

  it('stops the walk at an invisible generation', () => {
    const ids = descendantBoardIds(PARTIAL, 'atlas', 'all')
    expect(ids.sort()).toEqual(['atlas', 'ops'])
    expect(ids).not.toContain('bids-2026')
  })

  it('surfaces the orphan as a root so it does not vanish from the tree', () => {
    const roots = buildBoardTree(PARTIAL).map((n) => n.board.id)
    expect(roots).toContain('bids-2026')
  })

  it('ends the ancestor chain at the first board it cannot see', () => {
    expect(ancestorBoardIds(PARTIAL, 'bids-2026')).toEqual([])
    expect(ancestorBoardIds(BOARDS, 'bids-2026')).toEqual(['bids', 'atlas'])
  })
})

describe('cycle safety', () => {
  // 118's trigger refuses these at the database. The client can still be handed a partial or
  // stale list, and an infinite loop in a render path must not depend on an invariant enforced
  // somewhere else.
  const CYCLE = [
    { id: 'a', title: 'A', parent_board_id: 'c' },
    { id: 'b', title: 'B', parent_board_id: 'a' },
    { id: 'c', title: 'C', parent_board_id: 'b' },
  ]

  it('terminates on a three-board loop and visits each board once', () => {
    const ids = descendantBoardIds(CYCLE, 'a', 'all')
    expect(ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('terminates walking up a loop', () => {
    expect(ancestorBoardIds(CYCLE, 'a').length).toBeLessThanOrEqual(3)
  })

  it('treats a self-parent as a root rather than recursing', () => {
    const selfish = [{ id: 'x', title: 'X', parent_board_id: 'x' }]
    expect(buildBoardTree(selfish).map((n) => n.board.id)).toEqual(['x'])
    expect(descendantBoardIds(selfish, 'x', 'all')).toEqual(['x'])
  })

  it('flattens a looping forest without hanging', () => {
    expect(flattenBoardTree(buildBoardTree(CYCLE)).length).toBeLessThanOrEqual(3)
  })
})

describe('resolving a view scope', () => {
  it('an empty board list stays unbounded rather than becoming a list of every board', () => {
    expect(resolveScopedBoardIds(BOARDS, [], 'all')).toBeNull()
  })

  it('unions overlapping scopes without duplicating a board', () => {
    const ids = resolveScopedBoardIds(BOARDS, ['atlas', 'bids'], 'all')!
    expect([...ids].sort()).toEqual(['atlas', 'bids', 'bids-2026', 'ops'])
  })

  it('an unbounded scope admits every task', () => {
    expect(taskInScope({ board_id: 'anything' }, null)).toBe(true)
  })

  it('a bounded scope admits only its boards', () => {
    const ids = resolveScopedBoardIds(BOARDS, ['bids'], 'all')!
    expect(taskInScope({ board_id: 'bids-2026' }, ids)).toBe(true)
    expect(taskInScope({ board_id: 'ops' }, ids)).toBe(false)
  })

  it('a task with no board is never inside a bounded scope', () => {
    expect(taskInScope({ board_id: null }, ['atlas'])).toBe(false)
  })

  it('counts the boards a scope spans', () => {
    expect(scopeBoardCount(BOARDS, ['atlas'], 'all')).toBe(4)
    expect(scopeBoardCount(BOARDS, ['atlas'], 'direct')).toBe(3)
    expect(scopeBoardCount(BOARDS, ['atlas'], 'none')).toBe(1)
    expect(scopeBoardCount(BOARDS, [], 'all')).toBe(BOARDS.length)
  })
})

describe('the tree', () => {
  it('nests children under their parent with a depth', () => {
    const tree = buildBoardTree(BOARDS)
    const atlas = tree.find((n) => n.board.id === 'atlas')!
    expect(atlas.depth).toBe(0)
    expect(atlas.children.map((c) => c.board.id)).toEqual(['bids', 'ops'])
    expect(atlas.children[0].children[0].board.id).toBe('bids-2026')
    expect(atlas.children[0].children[0].depth).toBe(2)
  })

  it('sorts siblings by title so the order does not depend on fetch order', () => {
    const shuffled = [...BOARDS].reverse()
    const tree = buildBoardTree(shuffled)
    expect(tree.map((n) => n.board.id)).toEqual(['atlas', 'srg'])
  })

  it('flattens depth-first, which is the render order', () => {
    expect(flattenBoardTree(buildBoardTree(BOARDS)).map((n) => n.board.id))
      .toEqual(['atlas', 'bids', 'bids-2026', 'ops', 'srg'])
  })

  it('keeps every board exactly once', () => {
    expect(flattenBoardTree(buildBoardTree(BOARDS))).toHaveLength(BOARDS.length)
  })
})

describe('the parent picker', () => {
  // The database refuses these (118). A picker that offers one and then shows a database error
  // is a picker that lied - ATLAS_01 10.2.
  it('refuses the board itself and everything beneath it', () => {
    expect(invalidParentIds(BOARDS, 'atlas').sort())
      .toEqual(['atlas', 'bids', 'bids-2026', 'ops'])
  })

  it('leaves an unrelated root available', () => {
    expect(invalidParentIds(BOARDS, 'atlas')).not.toContain('srg')
  })

  it('a leaf may be parented anywhere but itself', () => {
    expect(invalidParentIds(BOARDS, 'bids-2026')).toEqual(['bids-2026'])
  })
})
