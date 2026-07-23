// Information architecture / route map — the single source of truth for the app
// shell's navigation. Kept as plain data + pure functions (no React, no lucide
// imports) so it is trivially unit-testable and can be rendered by any surface.
//
// Icons are referenced by string key and resolved to components in the sidebar, so
// this module stays dependency-free.
//
// `status` records the incremental migration (owner decision: shared shell in place,
// tabs -> routes one slice at a time):
//   - 'live'    : a real route exists today
//   - 'planned' : target route in the north-star IA, not built yet
//
// See docs/design/information-architecture.md for the human-readable map.

export type NavStatus = 'live' | 'planned'

export interface NavItem {
  /** Stable id, also used as the module key for gating. */
  id: string
  label: string
  /** Icon key resolved in app-sidebar.tsx. */
  icon: string
  /** Target route. For 'planned' items this is where the section will live. */
  href: string
  status: NavStatus
  /** If set, only users whose role is in this list should see the item. */
  roles?: Array<'user' | 'admin' | 'super_admin'>
  /** Feature-module key; when the module is disabled the item is hidden. */
  module?: string
}

export interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

// The "calm default" the product should open on for a brand-new user: Projects,
// My Work, Inbox, Search — plus the modules already built into today's app. Advanced
// modules (Strategy/Agile/Planning/Time/Cost/Clients/Automation) are NOT listed here;
// they arrive with tenancy + module activation after Prompt 3.
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'core',
    label: 'Work',
    items: [
      { id: 'my-work', label: 'My Work', icon: 'inbox-check', href: '/my-work', status: 'planned' },
      { id: 'projects', label: 'Projects', icon: 'kanban', href: '/projects', status: 'planned' },
      { id: 'inbox', label: 'Inbox', icon: 'bell', href: '/inbox', status: 'planned' },
    ],
  },
  {
    id: 'existing',
    label: 'Workspace',
    items: [
      { id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard?tab=calendar', status: 'live' },
      { id: 'marketing', label: 'Marketing', icon: 'megaphone', href: '/dashboard?tab=marketing', status: 'live', module: 'marketing' },
      { id: 'personal', label: 'Personal', icon: 'lock', href: '/dashboard?tab=personal', status: 'live' },
      { id: 'chat', label: 'Chat', icon: 'message', href: '/dashboard?tab=chat', status: 'live' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'admin-home', label: 'Admin', icon: 'shield', href: '/admin', status: 'live', roles: ['admin', 'super_admin'] },
      { id: 'super-admin', label: 'Super Admin', icon: 'crown', href: '/admin/super-admin', status: 'live', roles: ['super_admin'] },
    ],
  },
]

export type Role = 'user' | 'admin' | 'super_admin'

/** Is a nav item visible to this role, given the set of enabled feature modules? */
export function isNavItemVisible(
  item: NavItem,
  role: Role,
  enabledModules: ReadonlySet<string>
): boolean {
  if (item.roles && !item.roles.includes(role)) return false
  if (item.module && !enabledModules.has(item.module)) return false
  return true
}

/** Filter groups for a role, dropping items and any group left empty. */
export function visibleGroups(
  role: Role,
  enabledModules: ReadonlySet<string>,
  groups: NavGroup[] = NAV_GROUPS
): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => isNavItemVisible(i, role, enabledModules)) }))
    .filter((g) => g.items.length > 0)
}

/**
 * Which nav item is "active" for a pathname (+ optional ?tab=). Longest matching
 * href wins so `/admin/super-admin` beats `/admin`. Query-based live items match on
 * their tab param.
 */
export function activeNavId(
  pathname: string,
  tab: string | null = null,
  groups: NavGroup[] = NAV_GROUPS
): string | null {
  const items = groups.flatMap((g) => g.items)
  let best: { id: string; score: number } | null = null

  for (const item of items) {
    const [path, query] = item.href.split('?')
    let score = -1

    if (query) {
      // e.g. "/dashboard?tab=calendar" — match path AND the tab param.
      const wantTab = new URLSearchParams(query).get('tab')
      if (pathname === path && tab && wantTab === tab) score = path.length + 100
    } else if (pathname === path) {
      score = path.length + 50 // exact path match
    } else if (pathname.startsWith(path + '/')) {
      score = path.length // prefix match (nested route)
    }

    if (score >= 0 && (!best || score > best.score)) best = { id: item.id, score }
  }

  return best?.id ?? null
}
