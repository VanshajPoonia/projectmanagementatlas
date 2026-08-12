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

describe('task.edit — mirrors canEdit', () => {
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
  // restriction outranks every ownership rule — including the creator's own.
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
  // the regression that matters most — the restriction must be role-specific, not
  // "anyone without a role".
  it('leaves a plain member with no board role fully able to work', () => {
    expect(allows(actor({ boardRole: null }), 'task.create')).toBe(true)
    expect(allows(actor({ boardRole: 'member' }), 'task.edit', mine)).toBe(true)
  })
})

describe('task.schedule — mirrors canEditDueDate', () => {
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

describe('task.attachment.delete — mirrors canDeleteAttachments', () => {
  it('is creator-or-admin, not assignee', () => {
    expect(allows(actor(), 'task.attachment.delete', mine)).toBe(true)
    expect(allows(actor(), 'task.attachment.delete', assignedToMe)).toBe(false)
    expect(allows(actor({ platformRole: 'admin' }), 'task.attachment.delete', theirs)).toBe(true)
  })
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
  // hide the toggle from an admin who reached the board via /dashboard — the bug the
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

describe('viewing', () => {
  // Sight is granted by RLS/board membership; this layer must not add a second,
  // competing read rule that could disagree with the database.
  it('never denies task.view', () => {
    expect(allows(actor({ boardRole: 'client' }), 'task.view', theirs)).toBe(true)
  })
})
