import { describe, it, expect } from 'vitest'
import { can, allows, type Actor, type TaskSubject } from './capabilities'

// The point of these tests is that adopting the capability layer changed nobody's
// permissions. Each block below re-states one of the inline expressions that used to
// live in board-view / task-card / task-detail-modal and asserts `can()` agrees, so a
// future edit to capabilities.ts that quietly widens access fails here.

const ME = 'user-me'
const OTHER = 'user-other'

function actor(over: Partial<Actor> = {}): Actor {
  return { userId: ME, platformRole: 'user', boardRole: null, ...over }
}

const mine: TaskSubject = { created_by: ME }
const theirs: TaskSubject = { created_by: OTHER }
const assignedToMe: TaskSubject = { created_by: OTHER, assigneeIds: [ME] }

describe('task.edit - mirrors canEdit', () => {
  // was: !isRestrictedMember && (isAdmin || created_by === me || assigneeIds.includes(me))
  it('allows the creator', () => {
    expect(allows(actor(), 'task.edit', mine)).toBe(true)
  })

  it('allows an assignee who did not create it', () => {
    expect(allows(actor(), 'task.edit', assignedToMe)).toBe(true)
  })

  it('allows an assignee referenced by the legacy scalar assigned_to', () => {
    expect(allows(actor(), 'task.edit', { created_by: OTHER, assigned_to: ME })).toBe(true)
  })

  // task rows arrive with assigned_to embedded as a profile object in several queries;
  // reading it as a bare string there silently denies the assignee.
  it('allows an assignee referenced by an embedded assigned_to row', () => {
    expect(allows(actor(), 'task.edit', { created_by: OTHER, assigned_to: { id: ME } })).toBe(true)
  })

  it('denies an unrelated member, with an explanation', () => {
    const decision = can(actor(), 'task.edit', theirs)
    expect(decision.allowed).toBe(false)
    expect(decision.presentation).toBe('explain')
    expect(decision.reason).toBeTruthy()
  })

  it('allows an admin on work they neither created nor own', () => {
    expect(allows(actor({ platformRole: 'admin' }), 'task.edit', theirs)).toBe(true)
    expect(allows(actor({ platformRole: 'super_admin' }), 'task.edit', theirs)).toBe(true)
  })
})

describe('guest and client board roles', () => {
  // Migrations 065/067: guest/client may read a board's tasks but not write them. The
  // restriction outranks every ownership rule - including the creator's own.
  for (const boardRole of ['guest', 'client'] as const) {
    it(`blocks ${boardRole} from editing even their own task`, () => {
      const decision = can(actor({ boardRole }), 'task.edit', mine)
      expect(decision.allowed).toBe(false)
      expect(decision.presentation).toBe('explain')
      expect(decision.reason).toContain(boardRole === 'guest' ? 'Guest' : 'Client')
    })

    it(`blocks ${boardRole} from creating`, () => {
      expect(allows(actor({ boardRole }), 'task.create')).toBe(false)
    })

    it(`blocks ${boardRole} even when they are an admin`, () => {
      expect(allows(actor({ boardRole, platformRole: 'super_admin' }), 'task.delete', mine)).toBe(false)
    })
  }

  // The control case: a plain member with no board_members row is unaffected. This is
  // the regression that matters most - the restriction must be role-specific, not
  // "anyone without a role".
  it('leaves a plain member with no board role fully able to work', () => {
    expect(allows(actor({ boardRole: null }), 'task.create')).toBe(true)
    expect(allows(actor({ boardRole: 'member' }), 'task.edit', mine)).toBe(true)
  })
})

describe('task.schedule - mirrors canEditDueDate', () => {
  // was: !isRestrictedMember && (isAdmin || created_by === me)
  // Narrower than task.edit on purpose: an assignee may work the task but not move it.
  it('allows the creator but not a mere assignee', () => {
    expect(allows(actor(), 'task.schedule', mine)).toBe(true)
    expect(allows(actor(), 'task.schedule', assignedToMe)).toBe(false)
  })

  it('still allows an assignee to edit the task itself', () => {
    expect(allows(actor(), 'task.edit', assignedToMe)).toBe(true)
  })

  it('allows an admin', () => {
    expect(allows(actor({ platformRole: 'admin' }), 'task.schedule', theirs)).toBe(true)
  })
})

describe('task.attachment.delete - mirrors 091\'s DELETE policy', () => {
  // `uploaded_by = auth.uid() OR can_delete_task(t.created_by)`. The uploader clause was
  // missing, so an assignee could not delete a file they had attached themselves - a
  // capability strictly narrower than the policy it claims to mirror.
  it('allows the task creator and any admin', () => {
    expect(allows(actor(), 'task.attachment.delete', mine)).toBe(true)
    expect(allows(actor({ platformRole: 'admin' }), 'task.attachment.delete', theirs)).toBe(true)
  })

  it('allows whoever uploaded the file, even on someone else\'s task', () => {
    expect(allows(actor(), 'task.attachment.delete', { ...theirs, uploadedBy: ME })).toBe(true)
    expect(allows(actor(), 'task.attachment.delete', { ...assignedToMe, uploadedBy: ME })).toBe(true)
  })

  it('still refuses a bystander, and explains without mentioning due dates', () => {
    const decision = can(actor(), 'task.attachment.delete', { ...theirs, uploadedBy: OTHER })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).not.toContain('due date')
    expect(decision.reason).toContain('attached')
  })

  it('is still refused for a guest, whose uploads RLS would never have accepted', () => {
    expect(allows(actor({ boardRole: 'guest' }), 'task.attachment.delete', { ...mine, uploadedBy: ME })).toBe(false)
  })
})

describe('comment.create - mirrors the task_comments INSERT policy, not task.edit', () => {
  // 035 (restated by 101) gates commenting on can_view_task, NOT can_manage_task, and
  // task_restricted_by_board_role is only ANDed into the latter. Measured against real
  // RLS on the dev sandbox: a board guest who cannot edit or attach CAN comment.
  // Grouping this with task.edit denied the one capability a client portal is built on.
  for (const boardRole of ['guest', 'client'] as const) {
    it(`lets a ${boardRole} comment, because the database does`, () => {
      expect(allows(actor({ boardRole }), 'comment.create', theirs)).toBe(true)
    })

    it(`still refuses that ${boardRole} the writes RLS refuses`, () => {
      expect(allows(actor({ boardRole }), 'task.edit', theirs)).toBe(false)
      expect(allows(actor({ boardRole }), 'task.attach', theirs)).toBe(false)
    })
  }

  it('lets an unrelated member comment on work they cannot edit', () => {
    expect(allows(actor(), 'comment.create', theirs)).toBe(true)
    expect(allows(actor(), 'task.edit', theirs)).toBe(false)
  })
})

describe('members.manage - board creator only, no admin bypass', () => {
  // Migration 061 removed the admin bypass on board_members deliberately: an admin who
  // could re-add themselves to a private board made "remove this admin" meaningless.
  // Returning ALLOW for any admin told them a write the database would refuse was fine.
  const myBoard = { created_by: ME }
  const theirBoard = { created_by: OTHER }

  it('allows the board creator, admin or not', () => {
    expect(allows(actor(), 'members.manage', undefined, myBoard)).toBe(true)
    expect(allows(actor({ platformRole: 'admin' }), 'members.manage', undefined, myBoard)).toBe(true)
  })

  it('refuses an admin who did not create the board, and explains why', () => {
    const decision = can(actor({ platformRole: 'admin' }), 'members.manage', undefined, theirBoard)
    expect(decision.allowed).toBe(false)
    expect(decision.presentation).toBe('explain')
    expect(decision.reason).toContain('created this board')
  })

  it('hides it from a non-admin entirely', () => {
    expect(can(actor(), 'members.manage', undefined, theirBoard).presentation).toBe('hide')
  })

  it('refuses rather than guesses when no board was supplied', () => {
    expect(allows(actor({ platformRole: 'super_admin' }), 'members.manage')).toBe(false)
  })

  // project.manage is a different question with a different answer, and conflating the
  // two is what produced the bug above.
  it('does not drag project.manage down with it', () => {
    expect(allows(actor({ platformRole: 'admin' }), 'project.manage', undefined, theirBoard)).toBe(true)
  })
})

describe('share.external - resource owner/admin, narrowed by board role', () => {
  const myBoard = { created_by: ME }
  const theirBoard = { created_by: OTHER }

  it('allows task and board creators', () => {
    expect(allows(actor(), 'share.external', mine)).toBe(true)
    expect(allows(actor(), 'share.external', undefined, myBoard)).toBe(true)
  })

  it('hides sharing from an unrelated regular member', () => {
    expect(can(actor(), 'share.external', theirs).presentation).toBe('hide')
    expect(can(actor(), 'share.external', undefined, theirBoard).presentation).toBe('hide')
  })

  it('allows an admin for either resource shape', () => {
    const admin = actor({ platformRole: 'admin' })
    expect(allows(admin, 'share.external', theirs)).toBe(true)
    expect(allows(admin, 'share.external', undefined, theirBoard)).toBe(true)
  })

  for (const boardRole of ['guest', 'client'] as const) {
    it(`blocks a ${boardRole} even when they created the resource or are an admin`, () => {
      const restricted = actor({ platformRole: 'super_admin', boardRole })
      expect(allows(restricted, 'share.external', mine)).toBe(false)
      expect(allows(restricted, 'share.external', undefined, myBoard)).toBe(false)
    })
  }
})

describe('the isAdmin override', () => {
  // app/dashboard/board/[id]/page.tsx passes isAdmin={false} deliberately so that an
  // admin opening a board from /dashboard gets non-admin edit rules.
  it('lets a host force non-admin edit rules for an admin', () => {
    const viaDashboard = actor({ platformRole: 'admin', isAdmin: false })
    expect(allows(viaDashboard, 'task.edit', theirs)).toBe(false)
    expect(allows(viaDashboard, 'task.edit', mine)).toBe(true)
  })

  // ...but the large-upload gate reads the platform role directly, because the RLS
  // policy behind it calls private.is_admin_user(). Honouring the override here would
  // hide the toggle from an admin who reached the board via /dashboard - the bug the
  // original comment in task-detail-modal.tsx was written to prevent.
  it('does not let the override hide the large-upload path from a real admin', () => {
    expect(allows(actor({ platformRole: 'admin', isAdmin: false }), 'task.attach.large')).toBe(true)
    expect(allows(actor({ platformRole: 'super_admin', isAdmin: false }), 'task.attach.large')).toBe(true)
  })

  it('keeps the large-upload path away from a plain user, silently', () => {
    const decision = can(actor(), 'task.attach.large')
    expect(decision.allowed).toBe(false)
    expect(decision.presentation).toBe('hide')
  })
})

describe('presentation', () => {
  // "Hide" vs "disable and explain" is a product decision, not a styling one: an
  // explanation is owed whenever the user can see the thing they cannot act on.
  it('hides configuration surfaces from non-admins rather than explaining them', () => {
    for (const capability of ['project.manage', 'members.manage', 'audit.view'] as const) {
      expect(can(actor(), capability).presentation).toBe('hide')
    }
    // members.manage is excluded here on purpose - it is board-creator-scoped, so "an
    // admin may" is exactly the false statement it used to make. See its own block.
    for (const capability of ['project.manage', 'audit.view'] as const) {
      expect(allows(actor({ platformRole: 'admin' }), capability)).toBe(true)
    }
  })

  it('always carries a reason when it asks the UI to explain', () => {
    const denials = [
      can(actor(), 'task.edit', theirs),
      can(actor({ boardRole: 'guest' }), 'task.create'),
      can(actor({ boardRole: 'client' }), 'task.schedule', mine),
      can(actor(), 'task.schedule', assignedToMe),
    ]
    for (const decision of denials) {
      expect(decision.presentation).toBe('explain')
      expect(decision.reason && decision.reason.length).toBeGreaterThan(0)
    }
  })

  it('never returns a reason alongside an allow', () => {
    expect(can(actor(), 'task.edit', mine)).toEqual({ allowed: true, presentation: 'allow' })
  })
})

describe('the vocabulary itself', () => {
  // `task.view` used to exist and resolve to an unconditional ALLOW, which is not an
  // answer: who may see a task is private.can_view_task (visibility, assignment, board
  // privacy) and no client holds those inputs. A capability that always says yes exists
  // only to be trusted wrongly, so it was deleted rather than left as documentation.
  it('has no task.view to mislead a caller', () => {
    // @ts-expect-error - removed from the Capability union on purpose
    expect(() => can(actor(), 'task.view')).not.toThrow()
    // @ts-expect-error - see above
    expect(can(actor(), 'task.view')).toBeUndefined()
  })

  // Every capability that can deny must be able to say why, or the UI has nothing to
  // render and falls back to a control that looks broken.
  it('never denies with presentation "explain" and no reason', () => {
    const everyDenial = [
      can(actor({ boardRole: 'guest' }), 'task.create'),
      can(actor(), 'task.edit', theirs),
      can(actor(), 'task.schedule', assignedToMe),
      can(actor(), 'task.attachment.delete', { ...theirs, uploadedBy: OTHER }),
      can(actor({ platformRole: 'admin' }), 'members.manage', undefined, { created_by: OTHER }),
    ]
    for (const decision of everyDenial) {
      expect(decision.allowed).toBe(false)
      if (decision.presentation === 'explain') expect(decision.reason).toBeTruthy()
    }
  })
})
