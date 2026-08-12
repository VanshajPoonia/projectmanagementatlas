import { describe, it, expect } from 'vitest'
import {
  describeMembership,
  membershipIndex,
  nextTeamPosition,
  personLabel,
  sortPeople,
  sortTeams,
  teamSizes,
  toggleMembership,
  unassignedPeople,
  type TeamMemberRow,
  type TeamPerson,
  type TeamRow,
} from './teams'

const atlas: TeamRow = { id: 't-atlas', name: 'Atlas General Contracting', color: '#7c3aed', position: 0 }
const shanks: TeamRow = { id: 't-shanks', name: 'Shanks Realty Group', color: '#e91e8c', position: 1 }
const teams = [atlas, shanks]

const bobby: TeamPerson = { id: 'u-bobby', full_name: 'Bobby Shanks', email: 'bobby@goatlasgo.us', role: 'super_admin' }
const kayla: TeamPerson = { id: 'u-kayla', full_name: 'Kayla Viehland', email: 'kayla@goatlasgo.us', role: 'super_admin' }
const nameless: TeamPerson = { id: 'u-new', full_name: null, email: 'new@goatlasgo.us', role: 'user' }

const members: TeamMemberRow[] = [
  { team_id: 't-atlas', user_id: 'u-bobby' },
  { team_id: 't-shanks', user_id: 'u-bobby' },
  { team_id: 't-atlas', user_id: 'u-kayla' },
]

describe('membershipIndex', () => {
  it('collects every team a person belongs to', () => {
    const index = membershipIndex(members)
    expect([...(index.get('u-bobby') ?? [])].sort()).toEqual(['t-atlas', 't-shanks'])
    expect([...(index.get('u-kayla') ?? [])]).toEqual(['t-atlas'])
  })

  it('omits people with no rows rather than storing an empty set', () => {
    expect(membershipIndex(members).has('u-new')).toBe(false)
  })
})

describe('teamSizes', () => {
  it('counts members per team', () => {
    const sizes = teamSizes(teams, members)
    expect(sizes.get('t-atlas')).toBe(2)
    expect(sizes.get('t-shanks')).toBe(1)
  })

  // An empty team must still render "0 members" instead of disappearing from the count map.
  it('reports zero for a team nobody is in', () => {
    expect(teamSizes([...teams, { id: 't-empty', name: 'Ops', color: '#000', position: 2 }], members).get('t-empty')).toBe(0)
  })

  // Membership rows for a team that is not being displayed must not inflate another team.
  it('ignores rows pointing at unknown teams', () => {
    const stray = [...members, { team_id: 't-deleted', user_id: 'u-bobby' }]
    expect(teamSizes(teams, stray).get('t-atlas')).toBe(2)
    expect(teamSizes(teams, stray).has('t-deleted')).toBe(false)
  })
})

describe('unassignedPeople', () => {
  // The gap pnpm check:teams pins: 094 backfilled existing profiles, and nothing auto-joins a
  // new account. This is how a super admin is told somebody was never placed.
  it('finds people in no team at all', () => {
    expect(unassignedPeople([bobby, kayla, nameless], members).map((p) => p.id)).toEqual(['u-new'])
  })

  it('returns nobody once everyone has a team', () => {
    const complete = [...members, { team_id: 't-atlas', user_id: 'u-new' }]
    expect(unassignedPeople([bobby, kayla, nameless], complete)).toEqual([])
  })
})

describe('personLabel', () => {
  it('prefers the full name', () => {
    expect(personLabel(bobby)).toBe('Bobby Shanks')
  })

  it('falls back to email when the name is missing', () => {
    expect(personLabel(nameless)).toBe('new@goatlasgo.us')
  })

  // Real profiles rows carry blank strings, not just nulls (several seeded accounts do), so a
  // plain `??` fallback would render an empty row with no way to tell who it is.
  it('falls back past a whitespace-only name', () => {
    expect(personLabel({ id: 'x', full_name: '   ', email: 'x@y.z', role: 'user' })).toBe('x@y.z')
  })

  it('never renders an empty label', () => {
    expect(personLabel({ id: 'x', full_name: null, email: null, role: 'user' })).toBe('Unnamed user')
  })
})

describe('describeMembership', () => {
  it('lists team names in display order', () => {
    expect(describeMembership(teams, new Set(['t-shanks', 't-atlas'])))
      .toBe('Atlas General Contracting, Shanks Realty Group')
  })

  it('states the empty case in words', () => {
    expect(describeMembership(teams, new Set())).toBe('Not in any team')
    expect(describeMembership(teams, undefined)).toBe('Not in any team')
  })

  // A membership row can outlive the team it points at between a delete and a refetch.
  it('does not claim membership of teams it cannot name', () => {
    expect(describeMembership(teams, new Set(['t-deleted']))).toBe('Not in any team')
  })
})

describe('ordering', () => {
  it('sorts teams by position, then name', () => {
    const shuffled = [shanks, atlas, { id: 't-a', name: 'Ops', color: '#000', position: 0 }]
    expect(sortTeams(shuffled).map((t) => t.name)).toEqual([
      'Atlas General Contracting',
      'Ops',
      'Shanks Realty Group',
    ])
  })

  it('does not mutate its input', () => {
    const input = [shanks, atlas]
    sortTeams(input)
    expect(input[0]).toBe(shanks)
  })

  it('sorts people by the label actually shown', () => {
    expect(sortPeople([kayla, nameless, bobby]).map(personLabel)).toEqual([
      'Bobby Shanks',
      'Kayla Viehland',
      'new@goatlasgo.us',
    ])
  })
})

describe('nextTeamPosition', () => {
  it('starts at zero', () => {
    expect(nextTeamPosition([])).toBe(0)
  })

  // max+1 rather than length, so deleting the middle team doesn't collide the next insert.
  it('stays past the highest position after a deletion', () => {
    expect(nextTeamPosition([{ id: 'a', name: 'A', color: '#000', position: 7 }])).toBe(8)
  })
})

describe('toggleMembership', () => {
  it('adds a membership', () => {
    const next = toggleMembership(members, 't-shanks', 'u-kayla', true)
    expect(next).toHaveLength(4)
    expect(next).toContainEqual({ team_id: 't-shanks', user_id: 'u-kayla' })
  })

  it('removes a membership', () => {
    const next = toggleMembership(members, 't-atlas', 'u-kayla', false)
    expect(next).toHaveLength(2)
    expect(next).not.toContainEqual({ team_id: 't-atlas', user_id: 'u-kayla' })
  })

  // The composite PK makes a duplicate insert an error, so ticking an already-ticked box must
  // not produce two rows locally either.
  it('does not duplicate an existing membership', () => {
    expect(toggleMembership(members, 't-atlas', 'u-bobby', true)).toHaveLength(3)
  })

  it('leaves the caller array untouched so a failed write can restore it', () => {
    const before = [...members]
    toggleMembership(members, 't-atlas', 'u-bobby', false)
    expect(members).toEqual(before)
  })

  // Moving is remove-from-A then add-to-B; both halves compose without a refetch in between.
  it('composes into a move between teams', () => {
    const moved = toggleMembership(
      toggleMembership(members, 't-atlas', 'u-kayla', false),
      't-shanks',
      'u-kayla',
      true,
    )
    const kaylaTeams = membershipIndex(moved).get('u-kayla')
    expect([...(kaylaTeams ?? [])]).toEqual(['t-shanks'])
  })
})
