import { describe, expect, it } from 'vitest'
import {
  BOARD_ROLES,
  DEFAULT_BOARD_ROLE,
  ROLE_OPTIONS,
  canManageMembership,
  isBoardRole,
  isNoopPlan,
  membershipHint,
  planMembershipChanges,
  roleLabel,
  toMembershipRow,
  type MembershipRow,
} from './board-membership'

const member = (user_id: string, role: MembershipRow['role'] = 'member'): MembershipRow => ({ user_id, role })

describe('planMembershipChanges', () => {
  // THE regression test. The shipped bug was that saving a board rewrote every membership
  // row, and the rewrite dropped `role`. If this property holds, no unrelated edit can ever
  // disturb a role again, because an unchanged list produces no writes at all.
  it('writes nothing when the list has not changed', () => {
    const current = [member('a'), member('b', 'guest'), member('c', 'client')]
    const plan = planMembershipChanges(current, [...current])

    expect(plan).toEqual({ insert: [], update: [], remove: [] })
    expect(isNoopPlan(plan)).toBe(true)
  })

  it('is a no-op even when the same people arrive in a different order', () => {
    const current = [member('a'), member('b', 'guest')]
    expect(isNoopPlan(planMembershipChanges(current, [member('b', 'guest'), member('a')]))).toBe(true)
  })

  it('inserts only people who were not there before', () => {
    const plan = planMembershipChanges([member('a')], [member('a'), member('b', 'guest')])

    expect(plan.insert).toEqual([member('b', 'guest')])
    expect(plan.update).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('updates a role in place rather than removing and re-adding', () => {
    const plan = planMembershipChanges([member('a', 'member')], [member('a', 'client')])

    expect(plan.update).toEqual([member('a', 'client')])
    expect(plan.insert).toEqual([])
    expect(plan.remove).toEqual([])
  })

  it('removes people who are no longer listed', () => {
    const plan = planMembershipChanges([member('a'), member('b', 'guest')], [member('a')])

    expect(plan.remove).toEqual(['b'])
    expect(plan.insert).toEqual([])
    expect(plan.update).toEqual([])
  })

  it('handles an insert, an update and a removal in one save', () => {
    const plan = planMembershipChanges(
      [member('keep'), member('change', 'member'), member('drop', 'client')],
      [member('keep'), member('change', 'guest'), member('add', 'client')],
    )

    expect(plan.insert).toEqual([member('add', 'client')])
    expect(plan.update).toEqual([member('change', 'guest')])
    expect(plan.remove).toEqual(['drop'])
  })

  it('empties the list when everyone is unticked', () => {
    const plan = planMembershipChanges([member('a'), member('b')], [])
    expect(plan.remove.sort()).toEqual(['a', 'b'])
    expect(plan.insert).toEqual([])
  })

  it('adds everyone when the board had no members', () => {
    const plan = planMembershipChanges([], [member('a'), member('b', 'guest')])
    expect(plan.insert).toEqual([member('a'), member('b', 'guest')])
    expect(plan.remove).toEqual([])
  })

  // A picker that renders one row per person can't normally produce duplicates, but a
  // caller concatenating two sources could. Emitting two conflicting rows for one person
  // would fail the primary key at best and write the wrong role at worst.
  it('collapses duplicate user ids last-wins', () => {
    const plan = planMembershipChanges([], [member('a', 'member'), member('a', 'client')])
    expect(plan.insert).toEqual([member('a', 'client')])
  })

  it('does not mutate its inputs', () => {
    const current = [member('a')]
    const desired = [member('b', 'guest')]
    planMembershipChanges(current, desired)

    expect(current).toEqual([member('a')])
    expect(desired).toEqual([member('b', 'guest')])
  })

  it('treats a role change to the same value as no change', () => {
    expect(isNoopPlan(planMembershipChanges([member('a', 'guest')], [member('a', 'guest')]))).toBe(true)
  })
})

describe('toMembershipRow', () => {
  it('keeps a known role', () => {
    expect(toMembershipRow({ user_id: 'a', role: 'client' })).toEqual(member('a', 'client'))
  })

  // A row written before migration 065, or by a future migration this build predates.
  it('falls back to member for a missing or unknown role', () => {
    expect(toMembershipRow({ user_id: 'a' })).toEqual(member('a', 'member'))
    expect(toMembershipRow({ user_id: 'a', role: null })).toEqual(member('a', 'member'))
    expect(toMembershipRow({ user_id: 'a', role: 'owner' })).toEqual(member('a', 'member'))
  })

  // Showing them as a full member is wrong, but dropping them would hide a real person from
  // the access list, and an invisible member is the worse of the two failures.
  it('keeps the person rather than dropping them when the role is unrecognised', () => {
    expect(toMembershipRow({ user_id: 'a', role: 'nonsense' }).user_id).toBe('a')
  })
})

describe('canManageMembership', () => {
  // Migration 061: the creator is the sole owner of the membership list, with no admin
  // bypass. Getting this wrong is what made the old UI silently lie to non-creator admins.
  it('allows the board creator', () => {
    expect(canManageMembership({ created_by: 'u1' }, 'u1')).toBe(true)
  })

  it('refuses anyone else, including an admin', () => {
    expect(canManageMembership({ created_by: 'u1' }, 'u2')).toBe(false)
  })

  it('refuses when either side is missing', () => {
    expect(canManageMembership({ created_by: null }, 'u1')).toBe(false)
    expect(canManageMembership({ created_by: 'u1' }, null)).toBe(false)
    expect(canManageMembership(null, 'u1')).toBe(false)
    expect(canManageMembership(undefined, undefined)).toBe(false)
  })

  // Both null must not read as "equal, therefore allowed".
  it('refuses when both are null', () => {
    expect(canManageMembership({ created_by: null }, null)).toBe(false)
  })
})

describe('vocabulary', () => {
  it('exposes exactly the roles the CHECK constraint allows', () => {
    expect([...BOARD_ROLES]).toEqual(['member', 'guest', 'client'])
    expect(ROLE_OPTIONS.map((o) => o.value)).toEqual([...BOARD_ROLES])
  })

  it('defaults to the same role as the column default', () => {
    expect(DEFAULT_BOARD_ROLE).toBe('member')
  })

  it('recognises only real roles', () => {
    expect(isBoardRole('guest')).toBe(true)
    expect(isBoardRole('owner')).toBe(false)
    expect(isBoardRole(null)).toBe(false)
    expect(isBoardRole(undefined)).toBe(false)
  })

  it('labels every role', () => {
    for (const role of BOARD_ROLES) expect(roleLabel(role)).toBeTruthy()
  })

  // The two meanings of a membership row are opposite, so the copy must not be shared.
  it('describes a private list as a grant and a public one as a restriction', () => {
    expect(membershipHint(true)).toMatch(/only/i)
    expect(membershipHint(false)).toMatch(/already/i)
    expect(membershipHint(true)).not.toBe(membershipHint(false))
  })
})
