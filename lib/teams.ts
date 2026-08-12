// Pure helpers behind Super Admin > Teams. Kept separate from the component the way
// components/shell/sidebar-state.ts is kept apart from use-sidebar-state.ts: the membership
// arithmetic is worth testing without mounting React or touching Supabase.
//
// ⚠️ Nothing here enforces anything. Migration 094's RLS (private.is_super_admin_user()) is
// what actually decides who may change a team; this module only shapes what the UI draws.

export interface TeamRow {
  id: string
  name: string
  color: string
  position: number
}

export interface TeamMemberRow {
  team_id: string
  user_id: string
}

export interface TeamPerson {
  id: string
  full_name: string | null
  email: string | null
  role: string | null
}

/** userId -> set of team ids they belong to. */
export function membershipIndex(members: readonly TeamMemberRow[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const m of members) {
    let set = index.get(m.user_id)
    if (!set) {
      set = new Set<string>()
      index.set(m.user_id, set)
    }
    set.add(m.team_id)
  }
  return index
}

/** teamId -> member count. Teams with nobody in them still get an entry, at 0. */
export function teamSizes(
  teams: readonly TeamRow[],
  members: readonly TeamMemberRow[],
): Map<string, number> {
  const sizes = new Map<string, number>(teams.map((t) => [t.id, 0]))
  for (const m of members) {
    if (sizes.has(m.team_id)) sizes.set(m.team_id, (sizes.get(m.team_id) ?? 0) + 1)
  }
  return sizes
}

/**
 * People who belong to no team at all. 094 backfilled everyone who existed when it ran, but
 * nothing auto-joins a new account (asserted by pnpm check:teams), so this is how a super
 * admin notices somebody who was never placed.
 */
export function unassignedPeople(
  people: readonly TeamPerson[],
  members: readonly TeamMemberRow[],
): TeamPerson[] {
  const index = membershipIndex(members)
  return people.filter((p) => (index.get(p.id)?.size ?? 0) === 0)
}

/** Display name, falling back through the fields that may be blank on a profile. */
export function personLabel(person: TeamPerson): string {
  return person.full_name?.trim() || person.email?.trim() || 'Unnamed user'
}

/** "Atlas General Contracting, Shanks Realty Group" — or the empty-state phrase. */
export function describeMembership(
  teams: readonly TeamRow[],
  teamIds: ReadonlySet<string> | undefined,
): string {
  if (!teamIds || teamIds.size === 0) return 'Not in any team'
  const names = teams.filter((t) => teamIds.has(t.id)).map((t) => t.name)
  return names.length > 0 ? names.join(', ') : 'Not in any team'
}

/** Teams in the order the UI shows them: explicit position first, then name. */
export function sortTeams(teams: readonly TeamRow[]): TeamRow[] {
  return [...teams].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** People in the order the UI shows them, by display label. */
export function sortPeople(people: readonly TeamPerson[]): TeamPerson[] {
  return [...people].sort((a, b) => personLabel(a).localeCompare(personLabel(b)))
}

/**
 * The next `position` for a newly created team. Uses max+1 rather than length so it stays
 * correct after deletions, matching how company-management.tsx picks its position.
 */
export function nextTeamPosition(teams: readonly TeamRow[]): number {
  return teams.length === 0 ? 0 : Math.max(...teams.map((t) => t.position)) + 1
}

/**
 * Optimistic result of ticking/unticking one cell of the people x teams grid. Returned as a
 * new array so the caller can render immediately and swap back verbatim if the write fails.
 */
export function toggleMembership(
  members: readonly TeamMemberRow[],
  teamId: string,
  userId: string,
  shouldBelong: boolean,
): TeamMemberRow[] {
  const without = members.filter((m) => !(m.team_id === teamId && m.user_id === userId))
  return shouldBelong ? [...without, { team_id: teamId, user_id: userId }] : without
}
