import { describe, it, expect } from 'vitest'
import { addressableTabs, boardHref, buildWorkspaceNav, dashboardHost } from './workspace-nav'
import { DEFAULT_MODULES, type AppModule } from '@/lib/modules'

function ids(groups: ReturnType<typeof buildWorkspaceNav>, groupId = 'sections') {
  return groups.find((g) => g.id === groupId)?.items.map((i) => i.id) ?? []
}

const base = { role: 'user' as const, modules: DEFAULT_MODULES, canUseMarketingCalendar: true }

describe('buildWorkspaceNav', () => {
  it('always offers Home and My Work, whatever the module configuration', () => {
    const off: AppModule[] = DEFAULT_MODULES.map((m) => ({ ...m, enabled: false }))
    expect(ids(buildWorkspaceNav({ ...base, modules: off, canUseMarketingCalendar: false }))).toEqual([
      'tasks',
      'my-work',
    ])
  })

  it('lists My Work as a real destination, not a placeholder', () => {
    const item = buildWorkspaceNav(base)[0].items.find((i) => i.id === 'my-work')
    expect(item?.status).toBe('live')
    expect(item?.href).toBe('/my-work')
  })

  it('drops a section whose module is switched off', () => {
    const modules = DEFAULT_MODULES.map((m) => (m.module_key === 'chat' ? { ...m, enabled: false } : m))
    expect(ids(buildWorkspaceNav({ ...base, modules }))).not.toContain('chat')
    expect(ids(buildWorkspaceNav(base))).toContain('chat')
  })

  // Appointments seeds disabled (migration 080) and must stay hidden until a super_admin
  // switches it on - the nav is not allowed to reveal a module nobody enabled.
  it('honours the appointments module defaulting to off', () => {
    expect(ids(buildWorkspaceNav(base))).not.toContain('appointments')
    const on = DEFAULT_MODULES.map((m) =>
      m.module_key === 'appointments' ? { ...m, enabled: true } : m,
    )
    expect(ids(buildWorkspaceNav({ ...base, modules: on }))).toContain('appointments')
  })

  // Marketing needs BOTH the module and the per-user access check (migration 085): being
  // a calendar member must not resurrect a module the org has turned off, and the module
  // being on must not hand the section to someone with no calendar.
  it('requires the marketing module and calendar access together', () => {
    expect(ids(buildWorkspaceNav({ ...base, canUseMarketingCalendar: false }))).not.toContain('marketing')

    const moduleOff = DEFAULT_MODULES.map((m) =>
      m.module_key === 'marketing_calendar' ? { ...m, enabled: false } : m,
    )
    expect(ids(buildWorkspaceNav({ ...base, modules: moduleOff }))).not.toContain('marketing')
    expect(ids(buildWorkspaceNav(base))).toContain('marketing')
  })
})

// An admin's dashboard tabs are hosted at /admin: app/dashboard/page.tsx redirects them and
// drops the query string, so a '/dashboard?tab=' link built for an admin lands on whatever
// tab they had open last. This whole block is the regression guard for that.
describe('the tab host follows the role', () => {
  const href = (role: 'user' | 'admin' | 'super_admin', id: string) =>
    buildWorkspaceNav({ ...base, role })[0].items.find((i) => i.id === id)?.href

  it('sends a plain user to /dashboard', () => {
    expect(href('user', 'boards')).toBe('/dashboard?tab=boards')
  })

  it('sends an admin to /admin, never to the redirecting /dashboard', () => {
    expect(href('admin', 'boards')).toBe('/admin?tab=boards')
    expect(href('super_admin', 'boards')).toBe('/admin?tab=boards')
  })

  it('names each host’s own landing tab', () => {
    expect(href('user', 'tasks')).toBe('/dashboard?tab=tasks')
    expect(href('admin', 'overview')).toBe('/admin?tab=overview')
  })

  it('leaves standalone routes alone for every role', () => {
    for (const role of ['user', 'admin', 'super_admin'] as const) {
      expect(href(role, 'my-work')).toBe('/my-work')
    }
    const on = DEFAULT_MODULES.map((m) => (m.module_key === 'crm' ? { ...m, enabled: true } : m))
    expect(
      buildWorkspaceNav({ ...base, role: 'admin', modules: on })[0].items.find((i) => i.id === 'crm')
        ?.href,
    ).toBe('/crm')
  })

  it('never leaves a /dashboard link in an admin’s nav', () => {
    const hrefs = buildWorkspaceNav({ ...base, role: 'super_admin', canViewAudit: true })
      .flatMap((g) => g.items)
      .map((i) => i.href)
    expect(hrefs.filter((h) => h.startsWith('/dashboard'))).toEqual([])
  })
})

// admin-dashboard.tsx used to hand-write its own copy of this list, so a module switched on
// in Super Admin → Modules appeared on /dashboard, /my-work and /crm but never on /admin.
describe('boardHref', () => {
  // /dashboard/board/[id] renders with isAdmin={false} on purpose, so an admin sent there
  // loses Add Column, the column menu and the board rename with no explanation. The host
  // is a function of the viewer's role, exactly like dashboardHost.
  it('opens a board on the admin surface for both admin tiers', () => {
    expect(boardHref('admin', 'b1')).toBe('/admin/board/b1')
    expect(boardHref('super_admin', 'b1')).toBe('/admin/board/b1')
  })

  it('opens a board on the user surface for a plain member', () => {
    expect(boardHref('user', 'b1')).toBe('/dashboard/board/b1')
  })

  it('agrees with dashboardHost, so the two can never drift', () => {
    for (const role of ['user', 'admin', 'super_admin'] as const) {
      expect(boardHref(role, 'b1')).toBe(`${dashboardHost(role)}/board/b1`)
    }
  })
})

describe('admin-hosted sections', () => {
  const adminIds = (extra: Partial<Parameters<typeof buildWorkspaceNav>[0]> = {}) =>
    ids(buildWorkspaceNav({ ...base, role: 'admin', ...extra }))

  it('reaches an admin when appointments or CRM is switched on', () => {
    const on = DEFAULT_MODULES.map((m) =>
      m.module_key === 'appointments' || m.module_key === 'crm' ? { ...m, enabled: true } : m,
    )
    expect(adminIds()).not.toContain('crm')
    expect(adminIds({ modules: on })).toEqual(expect.arrayContaining(['appointments', 'crm']))
  })

  it('offers My Work to an admin too', () => {
    expect(adminIds()).toContain('my-work')
  })

  // Reports and the access log only render inside the admin dashboard, so offering either to
  // a plain member would be a dead link rather than a permission error.
  it('keeps reports and the access log off a plain user’s nav', () => {
    expect(ids(buildWorkspaceNav({ ...base, canViewAudit: true }))).not.toContain('reports')
    expect(ids(buildWorkspaceNav({ ...base, canViewAudit: true }))).not.toContain('access-log')
  })

  it('gives an admin reports, and the access log only with the capability', () => {
    expect(adminIds()).toContain('reports')
    expect(adminIds()).not.toContain('access-log')
    expect(adminIds({ canViewAudit: true })).toContain('access-log')
  })

  it('still drops reports when the module is switched off', () => {
    const off = DEFAULT_MODULES.map((m) => (m.module_key === 'reports' ? { ...m, enabled: false } : m))
    expect(adminIds({ modules: off })).not.toContain('reports')
  })
})

describe('admin group', () => {
  it('is absent for a plain user', () => {
    expect(buildWorkspaceNav(base).map((g) => g.id)).toEqual(['sections'])
  })

  // 'admin-home' pointed at /admin while Home pointed at a /dashboard URL that redirected
  // to the same screen: two entries, one destination. For an admin, Home *is* /admin.
  it('is absent for a plain admin, whose Home already is the admin dashboard', () => {
    const nav = buildWorkspaceNav({ ...base, role: 'admin' })
    expect(nav.map((g) => g.id)).toEqual(['sections'])
    expect(nav.flatMap((g) => g.items).map((i) => i.id)).not.toContain('admin-home')
  })

  it('gives super admins the super-admin entry alone', () => {
    expect(ids(buildWorkspaceNav({ ...base, role: 'super_admin' }), 'admin')).toEqual([
      'super-admin',
    ])
  })
})

describe('addressableTabs', () => {
  // ?tab= may only address sections the dashboard actually hosts. My Work is a route of
  // its own, so listing it as a tab would resolve to a screen that doesn't exist there.
  it('returns only dashboard-hosted sections', () => {
    const tabs = addressableTabs(buildWorkspaceNav(base))
    expect(tabs).toContain('calendar')
    expect(tabs).not.toContain('my-work')
    expect(tabs).not.toContain('admin-home')
  })

  it('recognises the /admin host as well as /dashboard', () => {
    const tabs = addressableTabs(
      buildWorkspaceNav({ ...base, role: 'super_admin', canViewAudit: true }),
    )
    expect(tabs).toEqual(expect.arrayContaining(['overview', 'calendar', 'reports', 'access-log']))
    expect(tabs).not.toContain('my-work')
    expect(tabs).not.toContain('super-admin')
  })

  it('shrinks with the nav when modules are switched off', () => {
    const modules = DEFAULT_MODULES.map((m) =>
      m.module_key === 'boards' ? { ...m, enabled: false } : m,
    )
    expect(addressableTabs(buildWorkspaceNav({ ...base, modules }))).not.toContain('boards')
  })
})
