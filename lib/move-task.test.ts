import { describe, it, expect } from 'vitest'
import {
  chooseDestinationColumn,
  describeMove,
  selectableBoards,
  type BoardOption,
  type DestinationColumn,
} from './move-task'

const live: BoardOption = { id: 'b-live', title: 'Operations' }
const other: BoardOption = { id: 'b-other', title: 'Atlas Build' }
const archived: BoardOption = { id: 'b-old', title: 'Zed Archive', archived_at: '2026-01-01T00:00:00Z' }

describe('selectableBoards', () => {
  it('drops the board the task is already on', () => {
    expect(selectableBoards([live, other], 'b-live').map((b) => b.id)).toEqual(['b-other'])
  })

  it('drops archived boards', () => {
    expect(selectableBoards([live, other, archived], null).map((b) => b.id)).toEqual(['b-other', 'b-live'])
  })

  it('sorts by title, case-insensitively', () => {
    const boards = [
      { id: '1', title: 'zebra' },
      { id: '2', title: 'Apple' },
      { id: '3', title: 'mango' },
    ]
    expect(selectableBoards(boards, null).map((b) => b.title)).toEqual(['Apple', 'mango', 'zebra'])
  })

  it('survives an empty or missing list', () => {
    expect(selectableBoards(null, 'b-live')).toEqual([])
    expect(selectableBoards([], 'b-live')).toEqual([])
  })

  it('keeps private boards — RLS already decided which ones the caller can see', () => {
    const secret: BoardOption = { id: 'b-secret', title: 'Acquisitions', is_private: true }
    expect(selectableBoards([secret], null).map((b) => b.id)).toEqual(['b-secret'])
  })
})

describe('chooseDestinationColumn', () => {
  const columns: DestinationColumn[] = [
    { id: 'c-todo', title: 'To Do', position: 0, status_key: 'to_do' },
    { id: 'c-doing', title: 'In Progress', position: 1, status_key: 'in_progress' },
    { id: 'c-done', title: 'Done', position: 2, status_key: 'done' },
  ]

  it('prefers the column explicitly linked to the status', () => {
    expect(chooseDestinationColumn('done', 'Done', columns)?.id).toBe('c-done')
  })

  it('falls back to a title match when no column carries the status_key', () => {
    const unlinked = columns.map((c) => ({ ...c, status_key: null }))
    expect(chooseDestinationColumn('in_progress', 'In Progress', unlinked)?.id).toBe('c-doing')
  })

  it('falls back to the same coarse bucket when the title does not match either', () => {
    // "WIP" is the exact case migration 063 was written for: no status_key, no matching
    // title, but plainly the in-progress column.
    const wip: DestinationColumn[] = [
      { id: 'c-open', title: 'Backlog', position: 0 },
      { id: 'c-wip', title: 'Ongoing', position: 1 },
    ]
    expect(chooseDestinationColumn('in_progress', 'In Progress', wip)?.id).toBe('c-wip')
  })

  it('lands on the leftmost column when the board has nothing resembling the status', () => {
    const sparse: DestinationColumn[] = [
      { id: 'c-second', title: 'Second', position: 1 },
      { id: 'c-first', title: 'First', position: 0 },
    ]
    // A board with no done-ish column still has to accept a finished task.
    expect(chooseDestinationColumn('done', 'Done', sparse)?.id).toBe('c-first')
  })

  it('orders by position, not by array order', () => {
    const shuffled: DestinationColumn[] = [
      { id: 'c-third', title: 'Third', position: 2 },
      { id: 'c-zero', title: 'Zero', position: 0 },
    ]
    expect(chooseDestinationColumn(null, undefined, shuffled)?.id).toBe('c-zero')
  })

  it('returns undefined for a board with no columns at all', () => {
    expect(chooseDestinationColumn('to_do', 'To Do', [])).toBeUndefined()
    expect(chooseDestinationColumn('to_do', 'To Do', null)).toBeUndefined()
  })
})

describe('describeMove', () => {
  it('names both boards and the landing column', () => {
    expect(describeMove('Operations', 'Atlas Build', 'To Do'))
      .toBe('moved this task from "Operations" to "Atlas Build" (To Do)')
  })

  it('omits the column when there is nothing useful to say', () => {
    expect(describeMove('Operations', 'Atlas Build'))
      .toBe('moved this task from "Operations" to "Atlas Build"')
    expect(describeMove('Operations', 'Atlas Build', '   '))
      .toBe('moved this task from "Operations" to "Atlas Build"')
  })

  it('degrades to a readable sentence when a title is missing', () => {
    expect(describeMove(null, undefined))
      .toBe('moved this task from "another board" to "another board"')
  })
})
