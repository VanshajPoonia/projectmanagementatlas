// The workspace navigation, derived once from role + enabled modules.
//
// This used to be built inline inside user-dashboard.tsx, which meant any new
// destination had to be added there *and* kept consistent with nav-model.ts's north-star
// map. Now the user dashboard, the admin dashboard, and the standalone routes (/my-work,
// /crm) all call this, so a module a super_admin switches on or off appears and
// disappears everywhere at once - sidebar, mobile bar, and ⌘K palette included.
//
// ⚠️ admin-dashboard.tsx used to keep its own hand-written copy of this list, and it was
// never updated when `appointments` (080) or `crm` (103) were added. Switching either on
// in Super Admin → Modules changed /dashboard, /my-work and /crm but left /admin - the
// screen an admin actually lands on - with no way to reach the module at all.
//
// Pure data (no React, no icons) so it stays unit-testable; hosts attach badges.

import { isModuleEnabled, type AppModule } from '@/lib/modules'
import type { NavGroup, NavItem, Role } from './nav-model'

export interface WorkspaceNavOptions {
  role: Role
  modules: AppModule[]
  /**
   * Admin, or a member of at least one marketing calendar (migration 085). Passed in
   * rather than derived here because it needs a query the caller already ran.
   */
  canUseMarketingCalendar: boolean
  /**
   * `audit.view` (migration 098) - admin + super_admin. Passed in for the same reason as
   * marketing: the caller already resolved it against lib/capabilities.ts. Not a module,
   * deliberately: a log you can switch off is not a log.
   */
  canViewAudit?: boolean
}

/** Tab ids differ per host because each dashboard names its own landing tab. */
const USER_HOME_TAB = 'tasks'
const ADMIN_HOME_TAB = 'overview'

/**
 * Which dashboard hosts this viewer's `?tab=` destinations.
 *
 * app/dashboard/page.tsx redirects an admin to /admin **and drops the query string**, so a
 * link built as '/dashboard?tab=boards' for an admin silently lands them on whatever tab
 * they had open last. The host is a function of role, never of the current URL.
 *
 * Exported because the ⌘K palette builds `?tab=` links too and had its own hardcoded
 * '/dashboard' - the exact bug this rule exists to prevent, reintroduced one file over.
 * One function, so the sidebar and the palette cannot disagree about where a tab lives.
 */
export function dashboardHost(role: Role): '/admin' | '/dashboard' {
  return role === 'admin' || role === 'super_admin' ? '/admin' : '/dashboard'
}

/**
 * Where a board opens for this viewer.
 *
 * Same rule as dashboardHost, and it exists for the same reason: the two board routes are
 * not interchangeable. `app/dashboard/board/[id]/page.tsx` passes `isAdmin={false}`
 * deliberately, so sending an admin to /dashboard/board/<id> silently strips the controls
 * they are entitled to - no Add Column, no column menu, no board rename - with nothing on
 * screen explaining why.
 *
 * ⚠️ Build board links from the viewer's **platform role**, never from a board surface's
 * own `isAdmin` flag. On /dashboard/board/<id> that flag is false even for a super admin,
 * so a link built from it pins them into the stripped surface for every board they open
 * next - and every board they star, since a favourite stores the href it was created from.
 */
export function boardHref(role: Role, boardId: string): string {
  return `${dashboardHost(role)}/board/${boardId}`
}

/**
 * Build the sidebar groups for a viewer.
 *
 * Home, My Work and Inbox are core: they are not registered modules and cannot be switched
 * off, because a workspace with no way to see your own work - or the things addressed to you
 * personally - isn't a workspace.
 */
export function buildWorkspaceNav({
  role,
  modules,
  canUseMarketingCalendar,
  canViewAudit = false,
}: WorkspaceNavOptions): NavGroup[] {
  const on = (key: Parameters<typeof isModuleEnabled>[1]) => isModuleEnabled(modules, key)

  const isAdmin = role === 'admin' || role === 'super_admin'
  const host = dashboardHost(role)
  const tab = (name: string) => `${host}?tab=${name}`
  const homeTab = isAdmin ? ADMIN_HOME_TAB : USER_HOME_TAB

  const items: NavItem[] = [
    { id: homeTab, label: 'Home', icon: 'home', href: tab(homeTab), status: 'live' },
    { id: 'my-work', label: 'My Work', icon: 'inbox-check', href: '/my-work', status: 'live' },
    // Inbox is core, not a module, for the same reason My Work is: a workspace where the
    // things addressed to you personally can be switched off is not a workspace. A real
    // route rather than a `?tab=`, so an admin's /dashboard redirect cannot strip it.
    { id: 'inbox', label: 'Inbox', icon: 'bell', href: '/inbox', status: 'live' },
    // Views is core, not a module. Prompt E's claim is that the view is not the data - the
    // filter/sort/group model is the foundation the other surfaces sit on, so there is nothing
    // coherent to switch off. A real route, like /my-work and /crm, so `?tab=`'s admin redirect
    // cannot strip it.
    { id: 'views', label: 'Views', icon: 'filter', href: '/views', status: 'live' },
  ]

  if (on('personal_tasks')) {
    items.push({ id: 'personal', label: 'Personal', icon: 'lock', href: tab('personal'), status: 'live' })
  }
  if (on('calendar')) {
    items.push({ id: 'calendar', label: 'Calendar', icon: 'calendar', href: tab('calendar'), status: 'live' })
  }
  if (canUseMarketingCalendar && on('marketing_calendar')) {
    items.push({ id: 'marketing', label: 'Marketing', icon: 'megaphone', href: tab('marketing'), status: 'live' })
  }
  // Reports is admin-hosted only: the user dashboard has no reports tab to link to, so
  // offering it to a plain member would be a dead link rather than a permission error.
  if (isAdmin && on('reports')) {
    items.push({ id: 'reports', label: 'Reports', icon: 'reports', href: tab('reports'), status: 'live' })
  }
  if (on('boards')) {
    items.push({ id: 'boards', label: 'Boards', icon: 'kanban', href: tab('boards'), status: 'live' })
  }
  if (on('chat')) {
    items.push({ id: 'chat', label: 'Chat', icon: 'message', href: tab('chat'), status: 'live' })
  }
  if (on('appointments')) {
    items.push({ id: 'appointments', label: 'Appointments', icon: 'appointments', href: tab('appointments'), status: 'live' })
  }
  if (on('crm')) {
    items.push({ id: 'crm', label: 'CRM', icon: 'crm', href: '/crm', status: 'live' })
  }
  // Agile is a module AND a per-board opt-in (migration 123). The nav entry only says the
  // module is on; whether any board actually runs sprints is answered on the page itself,
  // which is the honest split - a nav item that appeared only once somebody had already
  // configured a board would leave the feature unreachable, the defect this repo keeps
  // re-learning. A real route, like /crm and /my-work, so `?tab=`'s admin redirect cannot
  // strip it.
  if (on('agile')) {
    items.push({ id: 'agile', label: 'Agile', icon: 'agile', href: '/agile', status: 'live' })
  }
  // Strategy is a module and nothing else - unlike agile there is no per-board opt-in, because
  // every part of it is created explicitly by a person. A workspace with the module on and no
  // goals is a page that explains itself, which is the honest state to land on.
  if (on('strategy')) {
    items.push({ id: 'strategy', label: 'Strategy', icon: 'strategy', href: '/strategy', status: 'live' })
  }
  if (on('project_ids')) {
    items.push({ id: 'project-ids', label: 'Project IDs', icon: 'project-ids', href: tab('project-ids'), status: 'live' })
  }
  // Same host rule as reports - the access log only renders inside the admin dashboard.
  if (isAdmin && canViewAudit) {
    items.push({ id: 'access-log', label: 'Access log', icon: 'history', href: tab('access-log'), status: 'live' })
  }

  const groups: NavGroup[] = [{ id: 'sections', label: 'Workspace', items }]

  // No 'admin-home' item: for an admin, Home *is* /admin. It used to sit here pointing at
  // '/admin' next to a Home pointing at '/dashboard?tab=tasks' that redirected to the same
  // screen - two entries, one destination.
  if (role === 'super_admin') {
    groups.push({
      id: 'admin',
      label: 'Admin',
      items: [
        { id: 'super-admin', label: 'Super Admin', icon: 'crown', href: '/admin/super-admin', status: 'live', roles: ['super_admin'] },
      ],
    })
  }

  return groups
}

/**
 * Which tabs `?tab=` may address on this viewer's dashboard - the tab-hosted items only,
 * dropping standalone routes like /my-work and /crm.
 *
 * Hosts feed this straight to resolveActiveTab so the set of reachable tabs and the set of
 * visible nav items cannot disagree: a tab with no nav item is unreachable, and a nav item
 * with no tab lands on the fallback.
 */
export function addressableTabs(groups: NavGroup[]): string[] {
  return groups
    .flatMap((g) => g.items)
    .filter((item) => /^\/(dashboard|admin)\?tab=/.test(item.href))
    .map((item) => item.id)
}
