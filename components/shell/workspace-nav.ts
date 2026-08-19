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
 * Build the sidebar groups for a viewer.
 *
 * Home and My Work are core: they are not registered modules and cannot be switched off,
 * because a workspace with no way to see your own work isn't a workspace.
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
