import { describe, it, expect } from 'vitest'
import {
  NAV_GROUPS,
  isNavItemVisible,
  visibleGroups,
  activeNavId,
  type NavItem,
} from './nav-model'

const item = (over: Partial<NavItem> = {}): NavItem => ({
  id: 'x',
  label: 'X',
  icon: 'kanban',
  href: '/x',
  status: 'planned',
  ...over,
})

describe('isNavItemVisible', () => {
  const noModules = new Set<string>()

  it('hides role-restricted items from other roles', () => {
    const adminItem = item({ roles: ['admin', 'super_admin'] })
    expect(isNavItemVisible(adminItem, 'user', noModules)).toBe(false)
    expect(isNavItemVisible(adminItem, 'admin', noModules)).toBe(true)
    expect(isNavItemVisible(adminItem, 'super_admin', noModules)).toBe(true)
  })

  it('hides super-admin-only items from plain admins', () => {
    const superOnly = item({ roles: ['super_admin'] })
    expect(isNavItemVisible(superOnly, 'admin', noModules)).toBe(false)
    expect(isNavItemVisible(superOnly, 'super_admin', noModules)).toBe(true)
  })

  it('hides items whose module is not enabled', () => {
    const gated = item({ module: 'marketing' })
    expect(isNavItemVisible(gated, 'user', noModules)).toBe(false)
    expect(isNavItemVisible(gated, 'user', new Set(['marketing']))).toBe(true)
  })

  it('shows unrestricted items to everyone', () => {
    expect(isNavItemVisible(item(), 'user', noModules)).toBe(true)
  })
})

describe('visibleGroups', () => {
  it('drops groups that become empty after filtering', () => {
    const groups = visibleGroups('user', new Set<string>())
    // A plain user with no modules should not see the Admin group at all.
    expect(groups.find((g) => g.id === 'admin')).toBeUndefined()
  })

  it('reveals the marketing item only when the module is on', () => {
    const off = visibleGroups('user', new Set<string>())
    expect(off.flatMap((g) => g.items).some((i) => i.id === 'marketing')).toBe(false)
    const on = visibleGroups('user', new Set(['marketing']))
    expect(on.flatMap((g) => g.items).some((i) => i.id === 'marketing')).toBe(true)
  })

  it('shows the super-admin item only to super_admin', () => {
    const asAdmin = visibleGroups('admin', new Set<string>())
    expect(asAdmin.flatMap((g) => g.items).some((i) => i.id === 'super-admin')).toBe(false)
    const asSuper = visibleGroups('super_admin', new Set<string>())
    expect(asSuper.flatMap((g) => g.items).some((i) => i.id === 'super-admin')).toBe(true)
  })
})

describe('activeNavId', () => {
  it('matches an exact live path', () => {
    expect(activeNavId('/admin')).toBe('admin-home')
  })

  it('prefers the longer match for nested admin routes', () => {
    expect(activeNavId('/admin/super-admin')).toBe('super-admin')
  })

  it('matches query-tab live items via the tab param', () => {
    expect(activeNavId('/dashboard', 'calendar')).toBe('calendar')
    expect(activeNavId('/dashboard', 'marketing')).toBe('marketing')
  })

  it('does not match a tab item without the right tab', () => {
    expect(activeNavId('/dashboard', null)).toBeNull()
  })

  it('matches nested planned routes by prefix', () => {
    expect(activeNavId('/projects/123')).toBe('projects')
  })

  it('returns null when nothing matches', () => {
    expect(activeNavId('/totally-unknown')).toBeNull()
  })

  it('every nav item has a non-empty label and href', () => {
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        expect(i.label.length).toBeGreaterThan(0)
        expect(i.href.startsWith('/')).toBe(true)
      }
    }
  })
})
