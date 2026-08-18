/**
 * Moves the entry at `fromIndex` so it ends up at `toIndex`, returning a new
 * array. Any move that would change nothing — same index, or an index outside
 * the list — returns the ORIGINAL array by reference, so a caller can skip the
 * round-trip to the server with `if (next === list) return`. A stray drag can
 * never drop an entry out of the list or duplicate one.
 *
 * Lives in lib/ rather than beside either caller: the marketing calendar's
 * channel columns (088) and a board's kanban columns (106) are the same problem
 * twice, and both persist the result through an RPC that demands every id
 * exactly once. One implementation means one set of edge cases to get right.
 */
export function moveListItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items
  if (fromIndex < 0 || fromIndex >= items.length) return items
  if (toIndex < 0 || toIndex >= items.length) return items

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}
