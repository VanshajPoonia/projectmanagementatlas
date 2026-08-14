// The workspace navigation, derived once from role + enabled modules.
//
// This used to be built inline inside user-dashboard.tsx, which meant any new
// destination had to be added there *and* kept consistent with nav-model.ts's north-star
// map. Now both the dashboard and the standalone routes (/my-work) call this, so a
// module a super_admin switches off disappears everywhere at once — sidebar, mobile bar,
// and ⌘K palette included.
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
}

/**
 * Build the Workspace group.
 *
 * Home and My Work are core: they are not registered modules and cannot be switched off,
 * because a workspace with no way to see your own work isn't a workspace.
 */
export function buildWorkspaceNav({
  role,
  modules,
  canUseMarketingCalendar,
}: WorkspaceNavOptions): NavGroup[] {
  const on = (key: Parameters<typeof isModuleEnabled>[1]) => isModuleEnabled(modules, key)

  const items: NavItem[] = [
    { id: 'tasks', label: 'Home', icon: 'home', href: '/dashboard?tab=tasks', status: 'live' },
    { id: 'my-work', label: 'My Work', icon: 'inbox-check', href: '/my-work', status: 'live' },
  ]

  if (on('personal_tasks')) {
    items.push({ id: 'personal', label: 'Personal', icon: 'lock', href: '/dashboard?tab=personal', status: 'live' })
  }
  if (on('calendar')) {
    items.push({ id: 'calendar', label: 'Calendar', icon: 'calendar', href: '/dashboard?tab=calendar', status: 'live' })
  }
  if (canUseMarketingCalendar && on('marketing_calendar')) {
    items.push({ id: 'marketing', label: 'Marketing', icon: 'megaphone', href: '/dashboard?tab=marketing', status: 'live' })
  }
  if (on('boards')) {
    items.push({ id: 'boards', label: 'Boards', icon: 'kanban', href: '/dashboard?tab=boards', status: 'live' })
  }
  if (on('chat')) {
    items.push({ id: 'chat', label: 'Chat', icon: 'message', href: '/dashboard?tab=chat', status: 'live' })
  }
  if (on('appointments')) {
    items.push({ id: 'appointments', label: 'Appointments', icon: 'appointments', href: '/dashboard?tab=appointments', status: 'live' })
  }
  if (on('crm')) {
    items.push({ id: 'crm', label: 'CRM', icon: 'crm', href: '/crm', status: 'live' })
  }
  if (on('project_ids')) {
    items.push({ id: 'project-ids', label: 'Project IDs', icon: 'project-ids', href: '/dashboard?tab=project-ids', status: 'live' })
  }

  const groups: NavGroup[] = [{ id: 'sections', label: 'Workspace', items }]

  if (role === 'admin' || role === 'super_admin') {
    const adminItems: NavItem[] = [
      { id: 'admin-home', label: 'Admin', icon: 'shield', href: '/admin', status: 'live', roles: ['admin', 'super_admin'] },
    ]
    if (role === 'super_admin') {
      adminItems.push({ id: 'super-admin', label: 'Super Admin', icon: 'crown', href: '/admin/super-admin', status: 'live', roles: ['super_admin'] })
    }
    groups.push({ id: 'admin', label: 'Admin', items: adminItems })
  }

  return groups
}

/** Which tabs `?tab=` may address — the dashboard-hosted items only. */
export function addressableTabs(groups: NavGroup[]): string[] {
  return groups
    .flatMap((g) => g.items)
    .filter((item) => item.href.startsWith('/dashboard?tab='))
    .map((item) => item.id)
}
