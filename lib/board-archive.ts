/**
 * Moving a board between the live list and the archived list.
 *
 * Both moves are optimistic: the row is written, then the two client-side lists are adjusted so
 * the board appears to move immediately. The hazard is that a list can be told to accept the same
 * board twice. Nothing disables the Archive or Restore control while its write is in flight, so a
 * double-click fires the handler twice, and a plain `[board, ...prev]` then shows one board as two
 * entries. It looks like duplicated data and survives until the page is reloaded, which is what
 * "when you archive a board and then restore it, it then makes a double entry" describes.
 *
 * Reproduced in a real browser before this was written: two cards on screen, one row in the
 * database.
 */

/** Put a board at the head of a list, replacing any copy already in it. */
export function prependUnique<T extends { id: string }>(list: T[], board: T): T[] {
  return [board, ...list.filter((entry) => entry.id !== board.id)]
}

/** Drop every copy of a board from a list. */
export function withoutBoard<T extends { id: string }>(list: T[], boardId: string): T[] {
  return list.filter((entry) => entry.id !== boardId)
}
