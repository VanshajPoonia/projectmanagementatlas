// What happens to a person's work when their account is deleted.
//
// Migration 100 made the schema able to answer this at all: `boards.created_by` and
// `tasks.created_by` were NOT NULL with an ON DELETE SET NULL rule, a straight
// contradiction that made deleting any account that had ever created a board impossible.
//
// With that fixed, the database's own foreign keys do almost all the work — tasks, comments
// and company bookmarks keep their content and lose their author, memberships and personal
// data go. Exactly one thing cannot be left to a foreign key, and this module is about that
// one thing.

/** Reasons a deletion is refused before anything is touched. */
export type DeletionRefusal = 'self' | 'last-super-admin' | 'not-found'

export const REFUSAL_MESSAGES: Record<DeletionRefusal, string> = {
  self: 'You cannot delete your own account.',
  'last-super-admin':
    'This is the last super admin. Promote someone else first, or there would be nobody left who can manage the platform.',
  'not-found': 'That account no longer exists.',
}

export interface DeletionCandidate {
  id: string
  role: string | null
}

/**
 * Decide whether a deletion may proceed.
 *
 * The last-super-admin rule is the one that matters. Every management surface in this app
 * is gated on `is_super_admin_user()` — teams, statuses, companies, user administration — so
 * removing the final super admin would leave a running system that nobody can administer,
 * recoverable only through direct database access. Blocking it is cheaper than the recovery.
 */
export function checkDeletion(
  target: DeletionCandidate | null | undefined,
  actorId: string,
  superAdminCount: number,
): DeletionRefusal | null {
  if (!target) return 'not-found'
  if (target.id === actorId) return 'self'
  if (target.role === 'super_admin' && superAdminCount <= 1) return 'last-super-admin'
  return null
}

/**
 * Boards owned by the departing account, reassigned to whoever is performing the deletion.
 *
 * This is the single case where NULL is not good enough. `boards.created_by` is not
 * attribution — migration 061 makes it the sole authority over a private board's membership
 * list, with no admin bypass, deliberately. A board left with a NULL creator could never
 * have its members changed again by anybody, which turns "remove a departing employee" into
 * "permanently freeze the access list of every board they made".
 *
 * Nothing else is reassigned. Rewriting the author of a task or a comment would make it
 * claim to have been written by whoever ran the deletion, and a false record is worse than
 * an incomplete one.
 */
export const REASSIGNED_ON_DELETE = ['boards'] as const

/** Human-readable summary of what a deletion will do, shown before it is confirmed. */
export function describeDeletion(name: string, boardCount: number): string {
  const boards =
    boardCount === 0
      ? ''
      : ` ${boardCount} board${boardCount === 1 ? '' : 's'} they created will transfer to you.`

  return (
    `Delete ${name}'s account?` +
    ` Their tasks, comments and shared bookmarks stay exactly where they are, shown as written by a removed user.` +
    boards +
    ` Their personal tasks, private messages and bookmarks are deleted with the account. This cannot be undone.`
  )
}
