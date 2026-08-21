import { describe, expect, it } from 'vitest'

import { prependUnique, withoutBoard } from './board-archive'

const b = (id: string, title = id) => ({ id, title })

describe('prependUnique', () => {
  it('puts a board at the head of the list', () => {
    expect(prependUnique([b('a'), b('c')], b('z'))).toEqual([b('z'), b('a'), b('c')])
  })

  it('never lets one board appear twice, however many times it is added', () => {
    // The regression this pins: Restore prepended unconditionally and nothing disabled the
    // button while the write was in flight, so a double-click showed one board as two cards.
    // Measured in a browser: two entries on screen, one row in the database.
    let list = [b('a'), b('c')]
    list = prependUnique(list, b('a'))
    list = prependUnique(list, b('a'))
    expect(list).toEqual([b('a'), b('c')])
    expect(list.filter((x) => x.id === 'a')).toHaveLength(1)
  })

  it('takes the newly written row rather than keeping the stale copy', () => {
    const next = prependUnique([b('a', 'old name')], b('a', 'new name'))
    expect(next).toEqual([b('a', 'new name')])
  })

  it('works on an empty list', () => {
    expect(prependUnique([], b('a'))).toEqual([b('a')])
  })
})

describe('withoutBoard', () => {
  it('drops the board', () => {
    expect(withoutBoard([b('a'), b('c')], 'a')).toEqual([b('c')])
  })

  it('drops every copy, so a list that already doubled is repaired by a move', () => {
    expect(withoutBoard([b('a'), b('c'), b('a')], 'a')).toEqual([b('c')])
  })

  it('leaves the list alone when the board is not in it', () => {
    expect(withoutBoard([b('a')], 'zzz')).toEqual([b('a')])
    expect(withoutBoard([], 'zzz')).toEqual([])
  })
})
