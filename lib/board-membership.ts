// Board membership planning — what to write when someone edits a board's access list.
//
// ⚠️ This replaces a `delete().eq('board_id', …)` followed by a re-insert. That pattern
// looked harmless because membership *rows* survived it, but migration 065 added a `role`
// column and the re-insert never carried it, so every round-trip reset the role to its
// DEFAULT of 'member'. Editing a board's TITLE was enough to promote a guest to a full
// member, and the promotion is a real privilege change: `private.can_manage_task` keys off
// exactly that column, so the ex-guest could immediately create and edit tasks. Verified
// against real RLS before this module was written, and pinned by scripts/check-access-matrix.mjs.
//
// The fix is to diff rather than replace. The property that matters:
//
//   planMembershipChanges(x, x) === { insert: [], update: [], remove: [] }
//
// An edit that does not touch membership writes nothing at all, so no unrelated action can
// ever disturb a role again. It also makes the writes minimal, which matters because
// migration 061 made the board's CREATOR the only person who may write these rows — an
// admin who is not the creator has their DELETE match zero rows (not an error in PostgREST)
// and their INSERT rejected with 42501. Under delete-all-then-reinsert that combination
// silently reported success while changing nothing; see canManageMembership below.

import type { BoardRole } from '@/lib/capabilities'

export type { BoardRole }

/** A person's access to one board, as stored in `board_members`. */
export interface MembershipRow {
  user_id: string
  role: BoardRole
}

export interface MembershipPlan {
  insert: MembershipRow[]
  update: MembershipRow[]
  /** user_ids whose row should be removed entirely. */
  remove: string[]
}

export const BOARD_ROLES: readonly BoardRole[] = ['member', 'guest', 'client'] as const

/** Default for a newly ticked person — matches the column DEFAULT in migration 065. */
export const DEFAULT_BOARD_ROLE: BoardRole = 'member'

export function isBoardRole(value: unknown): value is BoardRole {
  return value === 'member' || value === 'guest' || value === 'client'
}

/**
 * Normalize whatever came back from the database. An unrecognised role is treated as
 * 'member' rather than dropped: the CHECK constraint makes it unreachable today, but if a
 * future migration adds a role this code doesn't know about, silently hiding that person
 * from the access list would be the more dangerous failure.
 */
export function toMembershipRow(row: { user_id: string; role?: string | null }): MembershipRow {
  return { user_id: row.user_id, role: isBoardRole(row.role) ? row.role : DEFAULT_BOARD_ROLE }
}

/**
 * Work out the minimal set of writes that turns `current` into `desired`.
 *
 * Rows present in both with the same role produce no write at all. Duplicate user_ids in
 * either list are collapsed last-wins, so a caller that builds `desired` from UI state
 * cannot accidentally emit two conflicting rows for one person.
 */
export function planMembershipChanges(
  current: readonly MembershipRow[],
  desired: readonly MembershipRow[],
): MembershipPlan {
  const currentByUser = new Map(current.map((row) => [row.user_id, row.role]))
  const desiredByUser = new Map(desired.map((row) => [row.user_id, row.role]))

  const plan: MembershipPlan = { insert: [], update: [], remove: [] }

  for (const [user_id, role] of desiredByUser) {
    const existing = currentByUser.get(user_id)
    if (existing === undefined) plan.insert.push({ user_id, role })
    else if (existing !== role) plan.update.push({ user_id, role })
  }

  for (const user_id of currentByUser.keys()) {
    if (!desiredByUser.has(user_id)) plan.remove.push(user_id)
  }

  return plan
}

/** True when a plan would write nothing, so the caller can skip the round-trips entirely. */
export function isNoopPlan(plan: MembershipPlan): boolean {
  return plan.insert.length === 0 && plan.update.length === 0 && plan.remove.length === 0
}

/**
 * May this person edit who has access to this board?
 *
 * Migration 061 deliberately removed the admin bypass that migration 049 had on
 * `board_members`: an admin who could re-add themselves to a private board made "remove
 * this admin's access" meaningless. The board's creator is the sole owner of its
 * membership list, and that is a security decision this module must not quietly widen —
 * the UI's job is to tell the truth about it, not to route around it.
 */
export function canManageMembership(
  board: { created_by?: string | null } | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(board?.created_by && userId && board.created_by === userId)
}

/** Sentence shown in place of the picker when the viewer is not the board's creator. */
export const MEMBERSHIP_LOCKED_REASON =
  'Only the person who created this board can change who has access to it.'

/**
 * What a `board_members` row actually MEANS depends on the board's visibility, and the
 * difference is easy to get backwards:
 *
 *   private board — the list is a GRANT. Nobody outside it can open the board at all.
 *   public board  — everyone can already see it, so a row can only ever RESTRICT. Listing
 *                   someone as a full member changes nothing; listing them as a guest or
 *                   client takes write access away.
 *
 * Saying this out loud in the UI is cheaper than letting an admin discover it by being
 * surprised.
 */
export function membershipHint(isPrivate: boolean): string {
  return isPrivate
    ? 'Only you and the people listed here can open this board, not even other admins.'
    : 'Everyone can already open this board. Adding someone here as a Guest or Client takes their editing rights away.'
}

export interface RoleOption {
  value: BoardRole
  label: string
  /** What this role can do, phrased for the person choosing it. */
  description: string
}

/**
 * Wording is deliberately about capability rather than mechanism. 'member' is described by
 * what it grants; the restricted roles are described by what they take away, because that
 * is the surprising part. Guest and client are genuinely identical today (see 065's header
 * on why they are still separate values) so their descriptions differ only in who they are
 * for, not in what they permit.
 */
export const ROLE_OPTIONS: readonly RoleOption[] = [
  { value: 'member', label: 'Full access', description: 'Can create, edit and complete tasks.' },
  { value: 'guest', label: 'Guest', description: 'Can read the board. Cannot add or change tasks.' },
  { value: 'client', label: 'Client', description: 'Read-only access for people outside the team.' },
] as const

export function roleLabel(role: BoardRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
}
