// Moving a task to a different board.
//
// A task's board is derived, not stored: tasks.column_id -> columns.board_id. So a move is a
// change of column, and the only real decision is *which* column on the destination board the
// card should land in. The rules live here rather than in the dialog so they can be tested
// without a browser, and so board-view can reuse them if a drag-between-boards ever lands.
//
// The write itself is public.move_task_to_board (migration 102), not an UPDATE from here:
// under RLS a refused UPDATE reports zero rows rather than an error, and subtasks have to
// move in the same transaction as their parent.

import { findColumnForStatus } from './task-status'

export interface BoardOption {
  id: string
  title: string
  archived_at?: string | null
  is_private?: boolean | null
}

export interface DestinationColumn {
  id: string
  title: string
  position?: number | null
  status_key?: string | null
}

/**
 * The boards worth offering as a destination.
 *
 * Archived boards are excluded — moving live work into an archive is almost certainly a
 * misclick, and the board list UI already hides them. The board the task is already on is
 * excluded because "move it to where it is" is not an action. Everything else the caller can
 * see is fair game; RLS decided what that is before this list was fetched, and migration 102
 * decides again at write time, so this filter is convenience, never a permission check.
 */
export function selectableBoards<T extends BoardOption>(
  boards: readonly T[] | null | undefined,
  currentBoardId: string | null | undefined,
): T[] {
  return (boards ?? [])
    .filter((board) => !board.archived_at && board.id !== currentBoardId)
    .slice()
    .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' }))
}

/**
 * Which column on the destination board should receive the task.
 *
 * Preference order, all of it delegated to findColumnForStatus so a move classifies a status
 * exactly the way the status dropdown and the board itself already do:
 *   1. a column explicitly linked to the task's status (columns.status_key — migration 063),
 *   2. a column whose title matches the status label,
 *   3. a column in the same coarse to_do/in_progress/done bucket,
 *   4. the leftmost column.
 *
 * Step 4 matters more than it looks: a board with no "Done" column must still be able to
 * receive a finished task. Landing it at the front, where it is visible, beats refusing the
 * move or dropping it somewhere the user did not choose and cannot find.
 */
export function chooseDestinationColumn(
  statusKey: string | null | undefined,
  statusLabel: string | undefined,
  columns: readonly DestinationColumn[] | null | undefined,
): DestinationColumn | undefined {
  if (!columns?.length) return undefined

  const ordered = columns
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const matched = statusKey
    ? findColumnForStatus(statusKey, statusLabel, ordered as any)
    : undefined

  return (matched as DestinationColumn | undefined) ?? ordered[0]
}

/**
 * The activity-log sentence for a completed move.
 *
 * Names both boards, because on the destination board the entry is the only record of where
 * the card came from — the source board keeps no trace of it at all once it has gone.
 */
export function describeMove(
  fromBoardTitle: string | null | undefined,
  toBoardTitle: string | null | undefined,
  toColumnTitle?: string | null,
): string {
  const from = (fromBoardTitle ?? '').trim() || 'another board'
  const to = (toBoardTitle ?? '').trim() || 'another board'
  const column = (toColumnTitle ?? '').trim()
  return column
    ? `moved this task from "${from}" to "${to}" (${column})`
    : `moved this task from "${from}" to "${to}"`
}
