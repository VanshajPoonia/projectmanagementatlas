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
  | 'task.view'
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

/**
 * Resolve one capability for one actor, optionally against one task.
 *
 * Behaviour is intentionally identical to the inline checks it replaces, so adopting it
 * is a refactor rather than a permission change; `capabilities.test.ts` pins each of the
 * original expressions.
 */
export function can(
  actor: Actor,
  capability: Capability,
  task?: TaskSubject,
): CapabilityDecision {
  const admin = isAdminActor(actor)
  const restricted = restrictedReason(actor.boardRole)

  switch (capability) {
    // Membership on the board is what grants sight of it; RLS decides the rest.
    case 'task.view':
      return ALLOW

    case 'task.create':
      // No task to own yet, so board role is the only gate.
      return restricted ? deny('explain', restricted) : ALLOW

    case 'task.edit':
    case 'task.delete':
    case 'task.assign':
    case 'task.attach':
    case 'comment.create': {
      if (restricted) return deny('explain', restricted)
      if (admin || isCreator(actor, task) || isAssignee(actor, task)) return ALLOW
      return deny('explain', NOT_OWNER)
    }

    case 'task.schedule':
    case 'task.attachment.delete': {
      if (restricted) return deny('explain', restricted)
      if (admin || isCreator(actor, task)) return ALLOW
      return deny('explain', NOT_SCHEDULER)
    }

    case 'task.attach.large': {
      if (restricted) return deny('explain', restricted)
      // Deliberately platform role, not the isAdmin override - see hasPlatformAdminRole.
      if (hasPlatformAdminRole(actor)) return ALLOW
      // Hidden rather than explained: a non-admin has no route to this and telling them
      // about an admin-only upload path is noise, not help.
      return deny('hide')
    }

    // Configuration surfaces. Non-admins have no path to these at all, so hide them
    // rather than advertising a door they cannot open.
    case 'project.manage':
    case 'members.manage':
    case 'audit.view':
      return admin ? ALLOW : deny('hide')

    case 'share.external':
      if (restricted) return deny('explain', restricted)
      return admin || isCreator(actor, task) ? ALLOW : deny('hide')

    case 'ai.execute':
      return ALLOW
  }
}

/** Convenience wrapper for the common `if (allowed)` case. */
export function allows(actor: Actor, capability: Capability, task?: TaskSubject): boolean {
  return can(actor, capability, task).allowed
}
