// Canonical capability vocabulary - one place that answers "may this person do this?"
//
// Until now the same expression lived inline in three files (board-view's
// `canManageTask`, task-card's `canEdit`/`canEditDueDate`, task-detail-modal's
// `canEdit`/`canEditDueDate`/`canDeleteAttachments`), each carrying a comment saying it
// mirrors the others. That is exactly the drift risk the plan's "canonical capability
// model" is meant to remove: three copies of a rule is three chances for one to be
// updated and the others not.
//
// ⚠️ This layer is for UX consistency only. **Postgres RLS remains authoritative** -
// migrations 065/067 are what actually stop a guest writing a task. Nothing here may be
// treated as a security boundary; a denial rendered by this module must never be the
// only thing standing between a user and a mutation.
//
// ⚠️ The corollary, learned the hard way (see docs/reviews/atlas-prompts-a-b-audit.md):
// a capability that is *stricter* than its policy is not "safe by default". It takes an
// ability away from someone the database was built to serve, and the user has no way to
// tell that refusal apart from a bug. Every entry below states which policy it mirrors,
// and the ones that deliberately differ say so and why.
//
// The vocabulary deliberately covers only capabilities that map to something that
// exists today. Speculative entries (approval.respond, automation.manage, budget/cost)
// are left out until their modules land, matching the same "don't build it
// speculatively" ruling that kept `team_role` off `team_members`.

/** Platform-wide role from `profiles.role`. */
export type PlatformRole = 'user' | 'admin' | 'super_admin'

/** Board-scoped role from `board_members.role` (migration 065). */
export type BoardRole = 'member' | 'guest' | 'client'

export type Capability =
  // Work items
  | 'task.create'
  | 'task.edit'
  | 'task.delete'
  | 'task.assign'
  /** Changing the due date - narrower than task.edit in this product (creator/admin only). */
  | 'task.schedule'
  | 'task.attach'
  /** The admin-only Storage path from migration 091, as opposed to the inline base64 one. */
  | 'task.attach.large'
  | 'task.attachment.delete'
  | 'comment.create'
  // Containers and configuration
  | 'project.manage'
  | 'members.manage'
  | 'share.external'
  | 'audit.view'
  | 'ai.execute'

// There is deliberately no `task.view`. It resolved to an unconditional ALLOW, which is
// not an answer - who may see a task is decided by `private.can_view_task` (visibility,
// assignment, board privacy), and no client holds the inputs to reproduce that. Asking
// the database and rendering what comes back is the only correct implementation, so the
// capability existed only to be trusted wrongly.

export interface Actor {
  userId: string
  platformRole: PlatformRole
  /** From the caller's own `board_members` row; null when they hold no explicit role. */
  boardRole?: BoardRole | null
  /**
   * Explicit admin override for the *board* surface. Needed because
   * `app/dashboard/board/[id]/page.tsx` deliberately passes `isAdmin={false}` even for
   * admins, so an admin browsing via /dashboard gets non-admin edit rules. When
   * omitted, admin-ness is derived from `platformRole`.
   */
  isAdmin?: boolean
}

/** Just enough of a task row to decide ownership; accepts the shapes actually in use. */
export interface TaskSubject {
  created_by?: string | null
  /** Sometimes a bare id, sometimes an embedded profile row - both appear in this app. */
  assigned_to?: string | { id?: string | null } | null
  /** Ids from `task_assignees`, however the caller already resolved them. */
  assigneeIds?: readonly string[] | null
  /**
   * Only for `task.attachment.delete`: who uploaded the attachment in question. The
   * DELETE policy (091) is `uploaded_by = auth.uid() OR can_delete_task(...)`, so the
   * uploader keeps control of their own file regardless of who owns the task.
   */
  uploadedBy?: string | null
}

/** Just enough of a board row to decide who administers it. */
export interface BoardSubject {
  created_by?: string | null
}

/**
 * How the UI should present an unavailable action.
 *   'allow'   - permitted, render normally
 *   'hide'    - irrelevant to this role; showing it is noise
 *   'explain' - the user can see the thing, so understanding the restriction helps
 *
 * The split is the plan's "UNAVAILABLE ACTION UX" requirement: never let a control look
 * functional and then fail silently, and never leave someone guessing whether a feature
 * is broken, disabled, or simply not theirs.
 */
export type Presentation = 'allow' | 'hide' | 'explain'

export interface CapabilityDecision {
  allowed: boolean
  presentation: Presentation
  /** User-facing sentence. Present whenever `presentation === 'explain'`. */
  reason?: string
}

const ALLOW: CapabilityDecision = { allowed: true, presentation: 'allow' }

function deny(presentation: Exclude<Presentation, 'allow'>, reason?: string): CapabilityDecision {
  return { allowed: false, presentation, reason }
}

/** guest/client are view-only on a board - the server-side rule from migrations 065/067. */
function restrictedReason(role: BoardRole | null | undefined): string | null {
  if (role === 'guest') return 'Guest access can open this board but not change its work.'
  if (role === 'client') return 'You can view this project, but Client access cannot edit internal tasks.'
  return null
}

function isAdminActor(actor: Actor): boolean {
  if (typeof actor.isAdmin === 'boolean') return actor.isAdmin
  return actor.platformRole === 'admin' || actor.platformRole === 'super_admin'
}

/**
 * True for admin AND super_admin, ignoring any `isAdmin` override.
 *
 * Mirrors `private.is_admin_user()` (migration 047), which is what the RLS policy behind
 * large uploads actually calls. Writing `role === 'admin'` here would exclude the two
 * super_admins - the same trap that made marketing column reordering silently fail.
 */
function hasPlatformAdminRole(actor: Actor): boolean {
  return actor.platformRole === 'admin' || actor.platformRole === 'super_admin'
}

function isCreator(actor: Actor, task: TaskSubject | undefined): boolean {
  return Boolean(task?.created_by && task.created_by === actor.userId)
}

function isAssignee(actor: Actor, task: TaskSubject | undefined): boolean {
  if (!task) return false
  const single = typeof task.assigned_to === 'string' ? task.assigned_to : task.assigned_to?.id
  if (single && single === actor.userId) return true
  return Boolean(task.assigneeIds?.includes(actor.userId))
}

const NOT_OWNER = 'Only the task’s creator, its assignees, or an admin can change it.'
const NOT_SCHEDULER = 'Only the task’s creator or an admin can change the due date.'
const NOT_UPLOADER = 'Only the person who attached this file, the task’s creator, or an admin can remove it.'
/** Exported: lib/board-membership.ts renders this same sentence in place of the picker. */
export const NOT_BOARD_CREATOR =
  'Only the person who created this board can change who has access to it.'

/**
 * Resolve one capability for one actor, optionally against one task and one board.
 *
 * `board` is only consulted by the container capabilities (`project.manage`,
 * `members.manage`); passing it for a task capability is harmless.
 */
export function can(
  actor: Actor,
  capability: Capability,
  task?: TaskSubject,
  board?: BoardSubject,
): CapabilityDecision {
  const admin = isAdminActor(actor)
  const restricted = restrictedReason(actor.boardRole)

  switch (capability) {
    case 'task.create':
      // No task to own yet, so board role is the only gate.
      return restricted ? deny('explain', restricted) : ALLOW

    case 'task.edit':
    case 'task.delete':
    case 'task.assign':
    case 'task.attach': {
      if (restricted) return deny('explain', restricted)
      if (admin || isCreator(actor, task) || isAssignee(actor, task)) return ALLOW
      return deny('explain', NOT_OWNER)
    }

    /**
     * Commenting is NOT restricted by board role, and that is the database's rule rather
     * than a relaxation invented here. The `task_comments` INSERT policy (035, restated by
     * 101) gates on `private.can_view_task`, not `can_manage_task`, and
     * `task_restricted_by_board_role` is only ANDed into the latter - so a guest or client
     * who can open a task may comment on it. Measured against real RLS, not inferred.
     *
     * It is also the point of the role: 065 keeps `client` as a distinct value because the
     * client portal will one day *hide internal comments* from them, which presupposes
     * they are talking to us in the first place. Denying it here would have made the one
     * capability a client portal is built on unreachable the moment anyone wired it up.
     *
     * Anyone rendering a task already passed `can_view_task`, so ALLOW is the honest
     * answer; RLS still refuses a comment on a task the caller cannot see.
     */
    case 'comment.create':
      return ALLOW

    case 'task.schedule': {
      if (restricted) return deny('explain', restricted)
      if (admin || isCreator(actor, task)) return ALLOW
      return deny('explain', NOT_SCHEDULER)
    }

    /**
     * Mirrors 091's DELETE policy: `uploaded_by = auth.uid() OR can_delete_task(created_by)`.
     * The uploader clause matters - this used to share a branch with `task.schedule`, so an
     * assignee could not delete a file they had attached themselves, and the refusal they
     * would have been shown talked about due dates.
     */
    case 'task.attachment.delete': {
      if (restricted) return deny('explain', restricted)
      if (task?.uploadedBy && task.uploadedBy === actor.userId) return ALLOW
      if (admin || isCreator(actor, task)) return ALLOW
      return deny('explain', NOT_UPLOADER)
    }

    case 'task.attach.large': {
      if (restricted) return deny('explain', restricted)
      // Deliberately platform role, not the isAdmin override - see hasPlatformAdminRole.
      if (hasPlatformAdminRole(actor)) return ALLOW
      // Hidden rather than explained: a non-admin has no route to this and telling them
      // about an admin-only upload path is noise, not help.
      return deny('hide')
    }

    // Board configuration (rename, colour, columns, archive) is admin-gated, matching the
    // `boards`/`columns` write policies. Non-admins have no path to it, so hide it.
    case 'project.manage':
      return admin ? ALLOW : deny('hide')

    /**
     * ⚠️ NOT the same rule as project.manage, and this used to return ALLOW for any admin.
     *
     * Migration 061 removed the admin bypass on `board_members` deliberately: an admin who
     * could re-add themselves to a private board made "remove this admin's access"
     * meaningless. The board's CREATOR is the sole owner of its membership list. An admin
     * who is not the creator gets a zero-row DELETE (not an error) and a 42501 on INSERT -
     * which is exactly how the old UI told them their changes had been saved when the
     * database had rejected every one. See lib/board-membership.ts.
     *
     * Explained rather than hidden when the caller is an admin: they can see the board and
     * would otherwise be left guessing why saving did nothing.
     */
    case 'members.manage': {
      if (board?.created_by && board.created_by === actor.userId) return ALLOW
      return admin ? deny('explain', NOT_BOARD_CREATOR) : deny('hide')
    }

    case 'audit.view':
      return admin ? ALLOW : deny('hide')

    /**
     * Minting a public URL for internal work. Migration 109 applies the same ordering at
     * the database: an explicit guest/client row removes the capability even from an admin
     * or resource creator; otherwise a task's creator, a board's creator, or an admin may
     * share. Keeping both resource shapes here lets board-view use the same vocabulary as
     * task-detail-modal instead of maintaining another inline approximation.
     */
    case 'share.external':
      if (restricted) return deny('explain', restricted)
      return admin || isCreator(actor, task) || board?.created_by === actor.userId
        ? ALLOW
        : deny('hide')

    /**
     * The AI assistant. Every signed-in person may use it; whether it exists at all is a
     * module question, not a capability one, and `app/api/ai-chat/route.ts` enforces that
     * server-side rather than trusting the widget to be absent.
     */
    case 'ai.execute':
      return ALLOW
  }
}

/** Convenience wrapper for the common `if (allowed)` case. */
export function allows(
  actor: Actor,
  capability: Capability,
  task?: TaskSubject,
  board?: BoardSubject,
): boolean {
  return can(actor, capability, task, board).allowed
}
