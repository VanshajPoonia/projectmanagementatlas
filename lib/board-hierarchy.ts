// Board hierarchy - resolving "and everything beneath it" without ever storing a list.
//
// ATLAS_01 4.6 is unusually specific about why this exists. A long-running Vikunja request asks
// for a parent project to show work from its children; the community workaround is a saved
// filter naming every child BY HAND, so a project created this morning is invisible to the
// roll-up until somebody remembers to edit the filter. Prompt E's instruction is a direct
// response: "New child projects must automatically become part of an all-descendants view. Do
// not store a static list of every descendant ID as the user-facing concept."
//
// So the user-facing concept is three words - none, direct, all - and membership is COMPUTED
// here, every time, from `boards.parent_board_id` (migration 118). There is no list to update
// because there is no list.
//
// ⚠️ THE INPUT IS ALREADY FILTERED BY RLS, AND THAT IS THE DESIGN.
// `boards`' SELECT policy hides a private board from a non-member and an archived board from a
// non-super-admin. This walks whatever the caller actually received, so a board they cannot see
// is simply not in their tree - and neither are its children, because the chain runs through it.
// That is the correct answer, not a bug: the alternative is announcing that a board exists.
// This is the one place in this repo where "hidden looks identical to does not exist" is the
// behaviour we want, which is why it is written down rather than left to be rediscovered.
//
// ⚠️ Residual worth naming: a VISIBLE board's `parent_board_id` may name an INVISIBLE one, and
// that column comes back with the row. So a uuid can leak, never a title and never content.
// `orphanRoots` treats such a board as a root so it still renders somewhere, rather than
// vanishing from the tree entirely.
//
// Pure - no Supabase, no React. The database has the same walk in public.board_descendants for
// callers that would rather push it down.

import type { DescendantScope } from './view-config'

export interface BoardNode {
  id: string
  title?: string | null
  parent_board_id?: string | null
  [key: string]: unknown
}

export interface BoardTreeNode<T extends BoardNode = BoardNode> {
  board: T
  depth: number
  children: BoardTreeNode<T>[]
}

/**
 * Children by parent id, plus the ids that are roots FOR THIS CALLER - which includes both real
 * roots (no parent) and orphans (a parent they cannot see).
 */
function index<T extends BoardNode>(boards: readonly T[]) {
  const byId = new Map<string, T>()
  for (const board of boards) byId.set(board.id, board)

  const childrenOf = new Map<string, T[]>()
  const roots: T[] = []

  for (const board of boards) {
    const parentId = board.parent_board_id ?? null
    if (!parentId || !byId.has(parentId) || parentId === board.id) {
      roots.push(board)
      continue
    }
    const siblings = childrenOf.get(parentId)
    if (siblings) siblings.push(board)
    else childrenOf.set(parentId, [board])
  }

  return { byId, childrenOf, roots }
}

/**
 * Every board at or beneath `rootId`, as ids, honouring the scope.
 *
 *   none   - just the board
 *   direct - the board and its immediate children
 *   all    - the board and every generation below it
 *
 * Always includes `rootId` itself, even when it is not in `boards`: a view scoped to a board is
 * scoped to that board whether or not the caller can read its row, and the tasks are gated by
 * their own policies anyway.
 *
 * Cycle-safe by a visited set. 118's trigger refuses cycles at the database, but a client can
 * be handed a partial list, and an infinite loop in a render path is not something to leave to
 * an invariant enforced somewhere else.
 */
export function descendantBoardIds<T extends BoardNode>(
  boards: readonly T[],
  rootId: string,
  scope: DescendantScope,
): string[] {
  if (scope === 'none') return [rootId]

  const { childrenOf } = index(boards)
  const maxDepth = scope === 'direct' ? 1 : Infinity

  const out: string[] = [rootId]
  const seen = new Set<string>([rootId])
  let frontier: string[] = [rootId]
  let depth = 0

  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1
    const next: string[] = []
    for (const id of frontier) {
      for (const child of childrenOf.get(id) ?? []) {
        if (seen.has(child.id)) continue
        seen.add(child.id)
        out.push(child.id)
        next.push(child.id)
      }
    }
    frontier = next
  }

  return out
}

/**
 * The board ids a view actually covers. Empty `boardIds` means "everything the caller can see",
 * which stays empty rather than becoming an explicit list - a view that enumerated every board
 * at save time would be exactly the static list Prompt E forbids, one level up.
 */
export function resolveScopedBoardIds<T extends BoardNode>(
  boards: readonly T[],
  boardIds: readonly string[],
  scope: DescendantScope,
): string[] | null {
  if (boardIds.length === 0) return null  // null = unbounded, not "no boards"
  const out = new Set<string>()
  for (const id of boardIds) {
    for (const descendant of descendantBoardIds(boards, id, scope)) out.add(descendant)
  }
  return [...out]
}

/** Does this task fall inside the scope? `null` scope means everything. */
export function taskInScope(task: { board_id?: string | null }, scopedIds: string[] | null): boolean {
  if (scopedIds === null) return true
  return !!task.board_id && scopedIds.includes(task.board_id)
}

/** The ancestor chain above a board, nearest first. Stops at the first board it cannot see. */
export function ancestorBoardIds<T extends BoardNode>(boards: readonly T[], boardId: string): string[] {
  const { byId } = index(boards)
  const out: string[] = []
  const seen = new Set<string>([boardId])
  let cursor = byId.get(boardId)?.parent_board_id ?? null

  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor)
    if (!parent) break  // invisible ancestor: the chain ends here for this caller
    seen.add(cursor)
    out.push(cursor)
    cursor = parent.parent_board_id ?? null
  }
  return out
}

/** The full forest, for a tree picker. Orphans surface as roots so nothing disappears. */
export function buildBoardTree<T extends BoardNode>(boards: readonly T[]): BoardTreeNode<T>[] {
  const { childrenOf, roots } = index(boards)
  const byTitle = (a: T, b: T) => String(a.title ?? '').localeCompare(String(b.title ?? ''))

  const build = (board: T, depth: number, seen: Set<string>): BoardTreeNode<T> => {
    seen.add(board.id)
    const children = (childrenOf.get(board.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .sort(byTitle)
      .map((child) => build(child, depth + 1, seen))
    return { board, depth, children }
  }

  const seen = new Set<string>()
  return [...roots].sort(byTitle).map((root) => build(root, 0, seen))
}

/** The tree flattened depth-first, which is how a picker or a sidebar renders it. */
export function flattenBoardTree<T extends BoardNode>(nodes: BoardTreeNode<T>[]): BoardTreeNode<T>[] {
  const out: BoardTreeNode<T>[] = []
  const walk = (list: BoardTreeNode<T>[]) => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Boards that may NOT be chosen as a parent for `boardId`: itself and everything beneath it.
 * The database refuses these anyway (118's trigger), but a picker that offers a choice and then
 * shows a database error is a picker that lied. ATLAS_01 10.2: say why up front.
 */
export function invalidParentIds<T extends BoardNode>(boards: readonly T[], boardId: string): string[] {
  return descendantBoardIds(boards, boardId, 'all')
}

/** How many boards a scope actually covers, for "this view spans 4 boards" in the UI. */
export function scopeBoardCount<T extends BoardNode>(
  boards: readonly T[],
  boardIds: readonly string[],
  scope: DescendantScope,
): number {
  const resolved = resolveScopedBoardIds(boards, boardIds, scope)
  return resolved === null ? boards.length : resolved.length
}
